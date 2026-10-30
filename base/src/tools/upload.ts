import type { FormatType, ImageInfo, ImageType, PDFAlbumResult, State } from '../types.js';

import { promises as fs } from 'node:fs';
import os from 'os';
import path from 'path';
import https from 'https';

import { OMNI_PROCESSING_THREADS, PROCESSING_THREADS } from '../globals.js';
import { api } from '../lib/micrioApi.js';
import { fsExists, jdToTime } from '../lib/utils.js';
import { Uploader } from '../lib/uploader.js';
import { process } from '../lib/tiler.js';
import { getArchiveBin } from '../lib/archive.js';
import { getPdfWasmUrl } from './pdf.js';
import { PdfRenderWorker } from './pdf-render.js';

const setStatus = (state:State, status:string, override?:boolean, noLog?:boolean) => {
	if(!state) return;
	if(state.job) state?.update?.(state.job.status = status);
	if(!noLog) state.log(status, override);
}

/** Process all specified and upload them to Micrio */
export async function upload(
	files:string[],
	opts:{
		destination?: string;
		format: FormatType;
		type: ImageType;
		pdfScale: string|number;
		account?: string;
		/** Tile into an existing image or album instead of creating one */
		existingId?: string;
		/** Resolve one ID for each PDF page (one call) */
		getIds?: (pages:{index:number;name:string}[]) => Promise<string[]>;
		/** Use this callback for status updates (6 = storing, 4 = completed) instead of the dashboard API */
		setStatus?: (id:string, data:{status:number;width?:number;height?:number;format?:FormatType;length?:number}) => void|Promise<void>;
		/** Signed upload URL provider */
		getUploadUrls?: (files:string[]) => Promise<string[]>;
		/** Render PDF pages in a worker thread (default: when getUploadUrls is set) */
		pdfWorker?: boolean;
		/** PDF display name for page titles */
		pdfName?: string;
		/** Album archive version (Unix seconds) */
		albumVersion?: number;
		outDir?: string;
	},
	state:State
) {
	if(!opts.existingId && !state?.account?.email) throw new Error(`Not logged in. Run 'micrio login' first`);

	let folder = '';
	const httpAgent = new https.Agent({
		rejectUnauthorized: true,
		keepAlive: true,
		// Keep-alive already reuses sockets; caching TLS session tickets made the runtime
		// dump binary session blobs to the logs for every new connection.
		maxCachedSessions: 0,
		timeout: 120_000
	});

	if(!opts.existingId) {
		let url:URL|undefined;
		try { url = new URL(opts.destination!) } catch(e) {
			throw new Error('Invalid target URL. This has to be the full URL of the target folder of the Micrio dashboard (https://dash.micr.io/...)');
		}
		folder = url.pathname;

		// Check if user has access to the requested destination folder
		// This automatically throws an error if the user doesn't have access or the folder doesn't exist
		await api(state.account!, httpAgent, `${folder}/access`);
	}

	const start = Date.now();

	if(!files.length) throw new Error('No images to process');

	let origImageNum = files.length;

	const outDir = opts.outDir ?? path.join(os.tmpdir(), '_micrio', Math.floor(Math.random()*10000000)+'');
	if(!await fsExists(outDir)) await fs.mkdir(outDir, { recursive: true });

	// TS is weird here -- if this can be undefined, compilation messes up
	let omni:{
		id?: string;
		width?: number;
		height?: number;
	} = {};

	const uploader = new Uploader(httpAgent, state, folder, opts.format, outDir, {
		getUploadUrls: opts.getUploadUrls
	});
	const hQueue:{[key:string]:Promise<any>} = {};

	// Omni images start with single image to create main ID
	// After the initial image is created, it has ID, and processing threads will be maximized
	let threads = opts.type == 'omni' ? 1 : PROCESSING_THREADS;

	let totalJobs:number = 0;
	let numProcessed:number = 0;
	let singleImageResultId:string|undefined;

	// Original files mapped to output directories
	const fileOutputDirs:Map<string, [string,ImageInfo][]> = new Map();

	// Process and upload an original image file while there are available threads
	const addToQueue = async (fileName:string, saveId:boolean, _opts:{
		omniFrameIdx?: number;
		pdfAlbum?: PDFAlbumResult;
		pageId?: string;
		pageName?: string;
		targetId?: string;
	} = {}) => {
		const queue = Object.values(hQueue);
		if(queue.length >= threads) await Promise.any(queue);
		const targetId = _opts.pageId ?? _opts.targetId;
		hQueue[fileName] = process(state, uploader, fileName, outDir, folder+(_opts.pdfAlbum ? '/'+_opts.pdfAlbum.slug:''), opts.format, opts.type, {
			omniId: omni?.id,
			omniFrame: _opts.omniFrameIdx,
			omniTotalFrames: totalJobs,
			id: targetId,
			setStatus: opts.setStatus,
		}).then(
			async r => {
				delete hQueue[fileName];
				numProcessed++;
				if(state.job) state.update?.(state.job.numProcessed = numProcessed);
				if(numProcessed==totalJobs) setStatus(state, 'Uploading...', false, true);
				if(opts.type == 'omni' && !omni.id) {
					fileOutputDirs.set(r.id, []);
					omni = r;
					threads = OMNI_PROCESSING_THREADS;
				}
				// When the user uploaded a single omni, pdf or image, return the view URL after completion
				if(saveId) singleImageResultId = r.id;
				// When reading to create preview archive, add the image ID there
				const dirKey = omni?.id || _opts.pdfAlbum?.id;
				if(dirKey) fileOutputDirs.get(dirKey)?.push([_opts.pageName ?? fileName, r]);
				if(_opts.pageId) await fs.rm(fileName, { force: true });
			},
			e => {
				// If one omni frame or pdf page fails, everything fails
				if(opts.existingId || opts.type == 'omni' || _opts.pdfAlbum) throw e;
				const message = e && typeof e == 'string' ? e : e?.message;
				state.log(`Error: Could not tile ${fileName}: ${message?.trim() ?? 'Unknown error'}`);
				origImageNum--;
			}
		)
	};

	const pdfAlbums:PDFAlbumResult[] = [];

	// PDF parser
	for(let i=0;i<files.length;i++) { const f = files[i]; if(f.toLowerCase().endsWith('.pdf')) {
		state?.log(`Parsing PDF file ${f}...`);

		let counter = 1;
		const scale = parseInt(opts.pdfScale ? opts.pdfScale.toString() : '4');
		// Server-side tilers (signed upload URLs) render in a worker; the CLI/GUI keeps the
		// in-process path. Rendering a large page blocks an event loop for seconds, which would
		// otherwise starve all in-flight tile uploads.
		const useWorker = (opts.pdfWorker ?? !!opts.getUploadUrls) && !!opts.existingId;
		let pageCount:number;
		let renderWorker:PdfRenderWorker|undefined;
		let document:any;
		if(useWorker) {
			renderWorker = new PdfRenderWorker(f, scale);
			pageCount = await renderWorker.ready.catch(async e => {
				await renderWorker!.terminate();
				throw new Error(`PDF reading error: ${e?.message ?? e}`);
			});
		} else {
			// Required for JPEG2000/JBIG2 scanned pages — see getPdfWasmUrl().
			// `wasmUrl` only exists in pdfjs-dist >=5, so a stale local pdf-to-img install (which can
			// still type-check as 4.x) makes the cast below necessary; consumers resolve >=6.
			const wasmUrl = getPdfWasmUrl();
			const { pdf } = await import('pdf-to-img');
			document = await pdf(f, {
				scale,
				...(wasmUrl ? { docInitParams: { wasmUrl } } : {})
			} as Parameters<typeof pdf>[1])
				.catch(e => {throw new Error(`PDF reading error: ${e.toString()}`)});
			pageCount = document.length;
		}
		if(!pageCount) throw new Error('PDF contains no pages');
		totalJobs+=pageCount;

		try {
			let pdfAlbum:PDFAlbumResult;
			let pageIds:string[]|undefined;
			let pdfName:string|undefined;

			if(opts.existingId) {
				if(!opts.getIds) throw new Error('No PDF page ID resolver supplied');
				pdfName = opts.pdfName ?? path.basename(f).replace(/\.pdf$/i, '');
				const definitions = Array.from({length: pageCount}, (_, i) => ({
					index: i + 1,
					name: `${pdfName}.${String(i + 1).padStart(4, '0')}`
				}));
				pageIds = await opts.getIds(definitions);
				if(pageIds.length != pageCount) throw new Error('Invalid PDF page ID response');
				pdfAlbum = { id: opts.existingId, slug: '', created: 0 };
			} else {
				// Create a new Micrio PDF album in the specified folder
				const created = await api<PDFAlbumResult>(state.account!, uploader.agent, `${folder}/create`,{
					name: encodeURIComponent(f),
					type: 'pdf'
				});
				if(!created) throw new Error('Could not create PDF album');
				pdfAlbum = created;
				pdfAlbums.push(pdfAlbum);
			}

			fileOutputDirs.set(pdfAlbum.id, []);
			const pdfDir = path.join(outDir, 'pdf');
			if(pageIds) await fs.mkdir(pdfDir, { recursive: true });

			const pageInfo = (index:number) => {
				const pageId = pageIds?.[index - 1];
				const pageName = pageId ? `${pdfName}.${index.toString().padStart(4, '0')}` : `${f}.${index.toString().padStart(4, '0')}.png`;
				return { pageId, pageName, fileName: pageId ? path.join(pdfDir, `${pageId}.png`) : pageName };
			};

			const pdfStart = Date.now();
			if(renderWorker) {
				// Request the next page before queueing the current one, so rendering keeps going
				// in the worker while the main thread tiles and uploads the previous page.
				let request = renderWorker.render(1, pageInfo(1).fileName);
				for(let index=1; index<=pageCount; index++) {
					const rendered = await request;
					state.log(`Processing page ${index} / ${pageCount} (rendered in ${rendered.ms}ms)...`, true);
					const info = pageInfo(index);
					if(index < pageCount) request = renderWorker.render(index + 1, pageInfo(index + 1).fileName);
					await addToQueue(info.fileName, files.length == 1, { pdfAlbum, pageId: info.pageId, pageName: info.pageName });
				}
			} else {
				const iterator = document[Symbol.asyncIterator]();
				while(true) {
					const renderStart = Date.now();
					const next = await iterator.next();
					const renderMs = Date.now() - renderStart;
					if(next.done) break;
					const info = pageInfo(counter);
					state.log(`Processing page ${counter} / ${pageCount} (rendered in ${renderMs}ms)...`, true);

					// Not using the async method here corrupts the written image -_-
					// Took a while to figure that out.
					await fs.writeFile(info.fileName, next.value);

					// Already start uploading and processing while parsing
					await addToQueue(info.fileName, files.length == 1, { pdfAlbum, pageId: info.pageId, pageName: info.pageName });

					counter++;
				}
			}
			state.log(`${pageCount} PDF pages prepared in ${Date.now() - pdfStart}ms`, true);
		} finally {
			await renderWorker?.terminate();
		}

		files.splice(i--, 1);
	}}

	// Regular image files
	if(files.length) {
		totalJobs+=files.length;
		setStatus(state, 'Processing...', false, true);
		if(files.length == 1) state?.log('Processing: ' + files[0]);
		for(let i=0;i<files.length;i++) await addToQueue(files[i], opts.type == 'omni' || files.length == 1, {
			omniFrameIdx: i,
			targetId: opts.existingId
		});
	}

	// Wait for all images to finish processing
	await Promise.all(Object.values(hQueue));

	// Wait until the Uploader has finished all of its individual upload threads
	await uploader.complete();

	// In case of an omni object or PDF file, create the pregenerated optimized viewing package
	// which contains thumbnails of each individual frame/page
	for(let [containerId, entries] of Array.from(fileOutputDirs.entries())) {
		const album = pdfAlbums.find(a => a.id == containerId);
		const albumVersion = opts.existingId
			? (opts.albumVersion ?? Math.floor(Date.now()/1000))
			: Math.floor(jdToTime(album?.created ?? 0)/1000);
		// Generate and upload the file and tell Micrio that the omni object or album is published
		uploader.add([
			{
				path: omni?.id ? `${omni.id}/base.bin` : `g/${containerId}.${albumVersion}.bin`,
				blob: await getArchiveBin(outDir, opts.format, containerId, entries, omni?.id)
			},
			...(opts.existingId ? [] : [() => api(state.account!, uploader.agent, `${folder}${album ? '/'+album.slug : ''}/@${omni?.id || 'album'}/status`, { status: 4, albumVersion: album?.created })])
		]);
	}

	// Wait until the Uploader has finished all of its individual upload threads
	await uploader.complete();
	state?.log();

	setStatus(state, 'Finalizing...');

	// Remove the entire original directory containing all tile results
	await fs.rm(outDir, {recursive: true, force: true});

	setStatus(state, `${origImageNum ? 'Succesfully a' : 'A'}dded ${opts.type == 'omni' ? `a 360 object image (${origImageNum} frames)` : `${origImageNum} file${origImageNum==1?'':'s'}`} in ${Math.round(Date.now()-start)/1000}s.`);

	if(singleImageResultId) setStatus(state, 'Resulting viewable URL: https://viewer.micr.io/'+singleImageResultId);
}

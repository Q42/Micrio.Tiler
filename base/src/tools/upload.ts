import type { FormatType, GroupInfo, ImageInfo, ImageType, PDFAlbumResult, State } from '../types.js';

import { pdf } from 'pdf-to-img';

import { promises as fs } from 'node:fs';
import os from 'os';
import path from 'path';
import https from 'https';

import { IS_STAGING, OMNI_PROCESSING_THREADS, PROCESSING_THREADS } from '../globals.js';
import { api } from '../lib/micrioApi.js';
import { fsExists, jdToTime } from '../lib/utils.js';
import { Uploader } from '../lib/uploader.js';
import { process } from '../lib/tiler.js';
import { getArchiveBin } from '../lib/archive.js';

const imagePreviewBase = IS_STAGING ? 'https://i.micrio.dev' : 'https://i.micr.io';

const setStatus = (state:State, status:string, override?:boolean, noLog?:boolean) => {
	if(!state) return;
	if(state.job) state?.update?.(state.job.status = status);
	if(!noLog) state.log(status, override);
}

/** Process all specified and upload them to Micrio */
export async function upload(
	files:string[],
	opts:{
		destination: string;
		format: FormatType;
		type: ImageType;
		pdfScale: string;
		account?: string;
		skipWatermark?: boolean;
	},
	state:State
) {
	if(!state?.account?.email) throw new Error(`Not logged in. Run 'micrio login' first`);

	let url:URL|undefined;
	try { url = new URL(opts.destination) } catch(e) {
		throw new Error('Invalid target URL. This has to be the full URL of the target folder of the Micrio dashboard (https://dash.micr.io/...)');
	}

	const folder = url.pathname;
	const groupSlug = folder.replace(/^\//, '').split('/')[0];
	const httpAgent = new https.Agent({rejectUnauthorized: true, keepAlive: true, timeout: 3000});

	// Check if user has access to the requested destination folder
	// This automatically throws an error if the user doesn't have access or the folder doesn't exist
	const groupInfo: GroupInfo = await api(state.account, httpAgent, 'GET', `/${groupSlug}/info`, );

	const start = Date.now();

	if(!files.length) throw new Error('No images to process');

	let origImageNum = files.length;

	const tmpDir = path.join(os.tmpdir(), '_micrio');
	if(!await fsExists(tmpDir)) await fs.mkdir(tmpDir);
	const outDir = path.join(tmpDir, Math.floor(Math.random()*10000000)+'');
	if(!await fsExists(outDir)) await fs.mkdir(outDir);

	// TS is weird here -- if this can be undefined, compilation messes up
	let omni:{
		id?: string;
		width?: number;
		height?: number;
	} = {};

	const uploader = new Uploader(httpAgent, state, folder, opts.format, outDir);
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
	} = {}) => {
		const queue = Object.values(hQueue);
		if(queue.length >= threads) await Promise.any(queue);
		hQueue[fileName] = process(state, uploader, fileName, outDir, folder+(_opts.pdfAlbum ? '/'+_opts.pdfAlbum.slug:''), opts.format, opts.type, {
			omniId: omni?.id,
			omniFrame: _opts.omniFrameIdx,
			omniTotalFrames: totalJobs,
			watermarkUrl: opts.skipWatermark ? undefined : groupInfo.watermarkUrl,
		}).then(
			r => {
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
				fileOutputDirs.get(omni?.id || _opts.pdfAlbum?.id)?.push([fileName, r]);
			},
			e => {
				// If one omni frame or pdf page fails, everything fails
				if(opts.type == 'omni' || _opts.pdfAlbum) throw e;
				state.log(`Error: Could not tile ${fileName}: ${e?.message?.trim() ?? 'Unknown error'}`);
				origImageNum--;
			}
		)
	};

	const pdfAlbums:PDFAlbumResult[] = [];

	// PDF parser
	for(let i=0;i<files.length;i++) { const f = files[i]; if(f.endsWith('.pdf')) {
		state?.log(`Parsing PDF file ${f}...`);

		let counter = 1;
		const document = await pdf(f, { scale: parseInt(opts.pdfScale||'4') })
			.catch(e => {throw new Error(`PDF reading error: ${e.toString()}`)});
		totalJobs+=document.length;

		// Create a new Micrio PDF album in the specified folder
		const pdfAlbum = await api<PDFAlbumResult>(state.account, uploader.agent, 'POST', `${folder}/create`,{
			name: encodeURIComponent(f),
			type: 'pdf'
		});

		fileOutputDirs.set(pdfAlbum.id, []);
		pdfAlbums.push(pdfAlbum);

		for await (const image of document) {
			state.log(`Processing page ${counter} / ${document.length}...`, true);
			const fName = `${f}.${(counter).toString().padStart(4, '0')}.png`;

			// Not using the async method here corrupts the written image -_-
			// Took a while to figure that out.
			await fs.writeFile(fName, image);

			// Already start uploading and processing while parsing
			await addToQueue(fName, files.length == 1, { pdfAlbum });

			counter++;
		}

		files.splice(i--, 1);
	}}

	// Regular image files
	if(files.length) {
		totalJobs+=files.length;
		setStatus(state, 'Processing...', false, true);
		for(let i=0;i<files.length;i++) await addToQueue(files[i], opts.type == 'omni' || files.length == 1, { omniFrameIdx: i });
	}

	// Wait for all images to finish processing
	await Promise.all(Object.values(hQueue));

	// Wait until the Uploader has finished all of its individual upload threads
	await uploader.complete();

	// In case of an omni object or PDF file, create the pregenerated optimized viewing package
	// which contains thumbnails of each individual frame/page
	for(let [containerId, entries] of Array.from(fileOutputDirs.entries())) {
		const album = pdfAlbums.find(a => a.id == containerId);
		// Generate and upload the file and tell Micrio that the omni object or album is published
		uploader.add([
			{
				path: omni?.id ? `${omni.id}/base.bin` : `g/${containerId}.${Math.floor(jdToTime(album.created)/1000)}.bin`,
				blob: await getArchiveBin(outDir, opts.format, containerId, entries, omni?.id)
			},
			() => api(state.account, uploader.agent, 'POST', `${folder}${album ? '/'+album.slug : ''}/@${omni.id || 'album'}/status`, { status: 4, albumVersion: album?.created })
		]);
	}

	// Wait until the Uploader has finished all of its individual upload threads
	await uploader.complete();
	state?.log();

	setStatus(state, 'Finalizing...');

	// Remove the entire original directory containing all tile results
	await fs.rm(outDir, {recursive: true, force: true});

	setStatus(state, `${origImageNum ? 'Succesfully a' : 'A'}dded ${opts.type == 'omni' ? `a 360 object image (${origImageNum} frames)` : `${origImageNum} file${origImageNum==1?'':'s'}`} in ${Math.round(Date.now()-start)/1000}s.`);

	if(singleImageResultId) setStatus(state, `Resulting viewable URL: ${imagePreviewBase}/${singleImageResultId}`);
}

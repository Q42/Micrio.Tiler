import type { FormatType, ImageType, R2StoreResult, State } from './types.js';

import { pdf } from 'pdf-to-img';

import { promises as fs } from 'node:fs';
import os from 'os';
import path from 'path';
import https from 'https';

import { OMNI_PROCESSING_THREADS, PROCESSING_THREADS } from './globals.js';
import { api } from './lib/micrioApi.js';
import { fsExists, walkSync } from './lib/utils.js';
import { Uploader } from './lib/uploader.js';
import { handle } from './lib/tiler.js';

const setStatus = (state:State, status:string, override?:boolean, noLog?:boolean) => {
	if(!state) return;
	if(state.job) state?.update?.(state.job.status = status);
	if(!noLog) state.log(status, override);
}

// Process all images and upload them to Micrio
export async function upload(
	files:string[],
	opts:{
		destination: string;
		format: FormatType;
		type: ImageType;
		pdfScale: string;
		account?: string;
	},
	state:State
) {
	if(!state?.account?.email) throw new Error(`Not logged in. Run 'micrio login' first`);

	let url:URL|undefined;
	try { url = new URL(opts.destination) } catch(e) {
		throw new Error('Invalid target URL. This has to be the full URL of the target folder of the Micrio dashboard (https://dash.micr.io/...)');
	}

	const folder = url.pathname;
	const httpAgent = new https.Agent({
		rejectUnauthorized: true,
		keepAlive: true,
		timeout: 3000
	});

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
	let threads = opts.type == 'omni' ? 1 : PROCESSING_THREADS;

	let totalJobs:number = 0;
	let numProcessed:number = 0;

	// Process and upload an original image file while there are available threads
	const addToQueue = async (fileName:string, _opts:{
		omniFrameIdx?: number;
		pdfAlbumSlug?: string;
	} = {}) => {
		const queue = Object.values(hQueue);
		if(queue.length >= threads) await Promise.any(queue);
		hQueue[fileName] = handle(state, uploader, fileName, outDir, folder, opts.format, opts.type, {
			omniId: omni?.id,
			omniFrame: _opts.omniFrameIdx,
			omniTotalFrames: totalJobs,
			albumSlug: _opts.pdfAlbumSlug
		}).then(
			r => {
				delete hQueue[fileName];
				numProcessed++;
				if(state.job) state.update?.(state.job.numProcessed = numProcessed);
				if(numProcessed==totalJobs) setStatus(state, 'Uploading...', false, true);
				if(opts.type == 'omni' && !omni.id) { omni = r; threads = OMNI_PROCESSING_THREADS; }
			},
			e => {
				// If one omni frame or pdf page fails, everything fails
				if(opts.type == 'omni' || _opts.pdfAlbumSlug) throw e;
				state.log(`Error: Could not tile ${fileName}: ${e?.message?.trim() ?? 'Unknown error'}`);
				origImageNum--;
			}
		)
	};

	// PDF parser
	for(let i=0;i<files.length;i++) { const f = files[i]; if(f.endsWith('.pdf')) {
		state?.log(`Parsing PDF file ${f}...`);

		let counter = 1;
		const document = await pdf(f, { scale: parseInt(opts.pdfScale||'4') })
			.catch(e => {throw new Error(`PDF reading error: ${e.toString()}`)});
		totalJobs+=document.length;

		// Create a new Micrio PDF album in the specified folder
		const pdfAlbumSlug = await api<{id:string}>(state.account, uploader.agent, `/api/cli${folder}/create`,{
			name: encodeURIComponent(f),
			type: 'pdf'
		}).then(r => r?.id);

		for await (const image of document) {
			state.log(`Processing page ${counter} / ${document.length}...`, true);
			const fName = `${f}.${(counter).toString().padStart(4, '0')}.png`;

			// Not using the async method here corrupts the written image -_-
			// Took a while to figure that out.
			await fs.writeFile(fName, image);

			// Already start uploading and processing while parsing
			await addToQueue(fName, { pdfAlbumSlug });

			counter++;
		}

		files.splice(i--, 1);
	}}

	// Regular image files
	if(files.length) {
		totalJobs+=files.length;
		setStatus(state, 'Processing...', false, true);
		for(let i=0;i<files.length;i++) await addToQueue(files[i], { omniFrameIdx: i });
	}

	// Wait for all images to finish processing
	await Promise.all(Object.values(hQueue));

	// Wait until the Uploader has finished all of its individual upload threads
	await uploader.complete();
	state?.log();

	// In case of an omni object, create the pregenerated optimized viewing package
	// which contains thumbnails of each individual frame
	// TODO this code can be optimized, for instance using the Uploader instead of
	// a `fetch()` call.
	if(omni.id && omni.width && omni.height) {
		const baseBinDir = path.join(outDir, omni.id+'_basebin');
		setStatus(state, 'Creating optimized viewing package...');

		await fs.mkdir(baseBinDir);
		let d = Math.max(omni.width, omni.height), l = 0;
		while(d > 1024) { d /= 2; l++; }
		let dzLevels = 0, max = Math.max(omni.width, omni.height);
		do dzLevels++; while ((max /= 2) > 1);
		const level = dzLevels - l;

		for(let i=0;i<files.length;i++) {
			const baseDir = path.join(outDir, omni.id, i.toString());
			const baseBinImgDir = path.join(baseBinDir, i.toString());
			await fs.mkdir(baseBinImgDir);
			await fs.rename(path.join(baseDir, level.toString()), path.join(baseBinImgDir, level.toString()));
		}

		const tiles:{
			path: string;
			buffer: Buffer;
		}[] = [];
		const baseTiles = await walkSync(baseBinDir);
		for(let t of baseTiles) tiles.push({
			path: t.replace(/\\/g,'/').replace(/^.*_basebin\//,''),
			buffer: await fs.readFile(t)
		});

		// TODO use Uploader for this logic because it's doubled code here
		const binPath = `${omni.id}/base.bin`;
		const postUri = await api<R2StoreResult>(state.account, httpAgent, `/api/${url.pathname.split('/')[1]}/store`, {
			files: [binPath]
		}).then(r => {
			if(!r) throw new Error('Upload permission denied.');
			return r.keys.map((sig,i) => `https://${r.r2Base}.r2.cloudflarestorage.com/${binPath}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=${r.key}%2F${r.time.slice(0,8)}%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=${r.time}&X-Amz-Expires=300&X-Amz-Signature=${sig}&X-Amz-SignedHeaders=host&x-id=PutObject`)
		});
		await fetch(postUri[0], {
			method: 'PUT',
			body: generateMDP(tiles),
			headers: { 'Content-Type': 'application/octet-stream' }
		});
		// Tell Micrio that the omni object is really done
		await api(state.account, uploader.agent, `/api/cli${folder}/@${omni.id}/status`, { status: 4 });
	}

	setStatus(state, 'Finalizing...');

	// Remove the entire original directory containing all tile results
	await fs.rm(outDir, {recursive: true, force: true});

	setStatus(state, `${origImageNum ? 'Succesfully a' : 'A'}dded ${opts.type == 'omni' ? `a 360 object image (${origImageNum} frames)` : `${origImageNum} file${origImageNum==1?'':'s'}`} in ${Math.round(Date.now()-start)/1000}s.`, true);
	state?.log();
}

function generateMDP(images:{
	path: string;
	buffer: Buffer;
}[]) {
	const enc = new TextEncoder();
	const arr:Uint8Array[] = [];
	images.forEach(i => {
		if(!i.buffer || !i.path) return;
		const name = enc.encode(i.path); // byte[20]
		const size = i.buffer.byteLength.toString(8); // byte[12]
		arr.push(name, new Uint8Array(20 - name.byteLength));
		arr.push(enc.encode('0'.repeat(12 - size.length)+size));
		arr.push(i.buffer);
	});

	return new Blob(arr, {type: 'application/octet-stream'});
}


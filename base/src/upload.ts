import type { FormatType, ImageInfo, ImageType, R2StoreResult, State, TileResult } from './types';

import { pdf } from 'pdf-to-img';

import { promises as fs } from 'node:fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import https from 'https';

const SIGNED_URIS = 480;
const UPLOAD_THREADS = 100;
const PROCESSING_THREADS = 8;
const OMNI_PROCESSING_THREADS = 2;
const NUM_UPLOAD_TRIES: number = 3;

const urlDashBase = 'https://dash.micr.io';

let state:State|undefined;

const fsExists = async (filePath:string) : Promise<boolean> => {
	try {
		await fs.access(filePath);
		return true; // File exists
	} catch (error) {
		return false; // File does not exist
	}
};

// Talk with the Micrio dashboard CLI API (dash.micr.io/api/cli/*)
// See github.com:Q42/Micrio/server/dash.micr.io for the server code
const api = <T>(agent: https.Agent, path:string, data:Object) : Promise<T|undefined> => new Promise((ok, err) => {
	if(!state?.account) return err(new Error('Not logged in'));
	const url = new URL(urlDashBase+path);
	const blob = JSON.stringify(data);
	const req = https.request({
		host: url.host,
		path: url.pathname+url.search,
		method: 'POST',
		agent: agent,
		headers: {
			'Cookie': `.AspNetCore.Identity.Application=${state.account.base64};`,
			'Content-Type': 'application/json',
			'Content-Length': blob.length
		}
	}, res => {
		const body:Uint8Array[] = [];
		res.on('data', chunk => {
			body.push(chunk);
		})
		.on('end', () => {
			const b = JSON.parse(Buffer.concat(body).toString());
			if(res.statusCode != 200) err(new Error(`${path}: ${res.statusCode} ${res.statusMessage}: ${b?.error ?? 'Unknown error'}`));
			else ok(b);
			req.destroy();
		});
	});
	req.on('error', (e) => {
		err(e);
		req.destroy();
	});
	req.write(blob);
	req.end();
})

const sanitize = (f:string, outDir:string) : string => f.replace(/\\+/g,'/').replace(outDir+'/','');

const setStatus = (status:string, override?:boolean, noLog?:boolean) => {
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
	_state:State
) {
	if(!_state?.account?.email) throw new Error(`Not logged in. Run 'micrio login' first`);

	state = _state;

	let url;
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

	const uploader = new Uploader(httpAgent, folder, opts.format, outDir);
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
		hQueue[fileName] = handle(uploader, fileName, outDir, folder, opts.format, opts.type, {
			omniId: omni?.id,
			omniFrame: _opts.omniFrameIdx,
			omniTotalFrames: totalJobs,
			albumSlug: _opts.pdfAlbumSlug
		}).then(
			r => {
				delete hQueue[fileName];
				numProcessed++;
				if(state.job) state.update?.(state.job.numProcessed = numProcessed);
				if(numProcessed==totalJobs) setStatus('Uploading...', false, true);
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
		const pdfAlbumSlug = await api<{id:string}>(uploader.agent, `/api/cli${folder}/create`,{
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
		setStatus(`Processing...`, false, true);
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
		setStatus('Creating optimized viewing package...');

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
		const postUri = await api<R2StoreResult>(httpAgent, `/api/${url.pathname.split('/')[1]}/store`, {
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
		await api(uploader.agent, `/api/cli${folder}/@${omni.id}/status`, { status: 4 });
	}

	setStatus('Finalizing...');

	// Remove the entire original directory containing all tile results
	await fs.rm(outDir, {recursive: true, force: true});

	setStatus(`${origImageNum ? 'Succesfully a' : 'A'}dded ${opts.type == 'omni' ? `a 360 object image (${origImageNum} frames)` : `${origImageNum} file${origImageNum==1?'':'s'}`} in ${Math.round(Date.now()-start)/1000}s.`, true);
	state?.log();
}

// Walk through a directory and all of its recursive subdirectories and return all files in it
export async function walkSync(name:string) : Promise<string[]> {
	const ret:string[] = [], entry = await fs.lstat(name).catch(() => {});
	if(entry) if(entry.isDirectory()) for (const file of await fs.readdir(name))
		ret.push(...await walkSync(path.join(name, file)))
	else ret.push(name)
	return ret;
}

const pdfPageRx = /^(.*\.pdf)\.(\d+)\.(png|tif)$/;

// This function does the actual image tiling using Sharp (libvips)
const tile = (destDir: string, file:string, format:FormatType) : Promise<TileResult> => new Promise((ok, err) => {
	fs.readFile(file).then(blob => {
		if(state?.job) state.job.bytesSource += blob.byteLength;
		sharp(blob, {
			// Manual hard limit at 1,000,000 x 1,000,000 px
			limitInputPixels: 1E6 * 1E6,
			// By default, sharp has a low limit
			unlimited: true
		}).toFormat(format, {
			// Default is WebP, and 75 is OK, otherwise it's JPG
			quality: format == 'webp' ? 75 : 85
		}).tile({
			// Tile size
			size: 1024,
			// Micrio doesn't require an extra padded pixel
			overlap: 0,
			depth: 'onepixel',
			container: 'fs',
			// This command makes the image into a deepzoom tile pyramid
			// The output of this operation will result in a directory with all zoom levels and tiles
			layout: 'dz'
		}).toFile(destDir, (error:any, info?:TileResult) => {
			if(error||!info) err(error??'Could not tile image');
			else ok(info);
		})
	}).catch(() => err('Could not read file: ' + file));
});

async function handle(
	uploader:Uploader,
	f:string,
	outDir:string,
	folder:string,
	format:FormatType,
	type:ImageType,
	opts:{
		omniId?:string;
		omniFrame?:number;
		omniTotalFrames?:number;
		albumSlug?:string;
	} = {}
) : Promise<ImageInfo> {
	const isOmni = type=='omni';
	const isPdfPage = pdfPageRx.test(f);

	if(!await fsExists(f)) throw new Error(`File '${f}' not found`);

	const fName = isPdfPage ? path.basename(f).replace(/\.(tif|png)$/,'') : path.basename(f);

	const res = opts.omniId ? {id: opts.omniId} : await api<{id:string}>(uploader.agent, `/api/cli${folder}${opts.albumSlug ? '/'+opts.albumSlug:''}/create`,{
		name: encodeURIComponent(fName), type, format
	});
	if(!res) throw new Error('Could not create image in Micrio! Do you have the correct permissions?');

	outDir = sanitize(outDir,outDir)
	const baseDir = path.join(outDir, res.id, isOmni ? opts.omniFrame.toString() : '');

	const {width, height} = await tile(baseDir, f, format);
	if(!height || !width) throw new Error('Could not read image dimensions');

	// If this is an extracted PNG file out of an original PDF file, we no longer need it
	if(isPdfPage) await fs.rm(f);

	// Sharp (libvips) always puts the tiles in `name_files` -- rename to our standard
	await fs.rename(baseDir+'_files', baseDir);
	// Delete libvips output meta data file, not needed
	await fs.rm(path.join(baseDir, 'vips-properties.xml'));

	// Update status to Micrio
	// `omniId` is only defined for the SECOND and later frames of an omni object
	// So the first frame of an omni object will do this call.
	if(!opts.omniId) await api(uploader.agent, `/api/cli${folder}/@${res.id}/status`, {
		width, height, status: 6, format, length: opts.omniTotalFrames
	});

	// Get all tiles from all subfolders of the output directory
	uploader.add(await walkSync(baseDir));

	// Add a final Uploader job to set the Micrio image status to Completed (4)
	// TODO: It's possible that this function is called if there are still ongoing tile uploads
	// of this image. Fix this by adding a separate `oncomplete` trigger in Uploader for this individual
	// tiled image, which should trigger this.
	if(type != 'omni') uploader.add([() => api(uploader.agent, `/api/cli${folder}/@${res.id}/status`, { status: 4 })]);

	// Remove the libvips-generated deepzoom meta file
	await fs.rm(baseDir+'.dzi');

	return { id: res.id, width, height };
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

type JobType = string|(() => Promise<any>);

class Uploader {
	private jobs:JobType[] = [];
	private oncomplete:Function|undefined;
	private uris:{[key:string]:string|Promise<void>} = {};

	running:Map<JobType, Promise<any>> = new Map();
	errored:Map<JobType, number> = new Map();

	constructor(
		public agent:https.Agent,
		private folder:string,
		private format:FormatType,
		private outDir:string
	) {
		this.outDir = sanitize(outDir, outDir);
	}

	// This is called for each individual resulting tile of an image operation
	// Or the final function to send the succesful status to Micrio after all tiles
	// of an image have been uploaded.
	add(jobs:JobType[]) {
		this.jobs.push(...jobs);
		if(state?.job) state?.update?.(state.job.numUploads += jobs.length);
		this.nextBatch();
	}

	complete() : Promise<void> { return new Promise(ok => {
		if(this.jobs.length+this.running.size == 0) return ok();
		this.oncomplete = ok;
	}) }

	// Get signed R2 upload URLs for the next batch of queued file uploads
	private getUploadUris(first?:string) : Promise<void>|void {
		const files = this.jobs.filter(t => !(t instanceof Function || this.uris[t])).slice(0, SIGNED_URIS - (first ? 1 : 0)) as string[];
		if(first) files.unshift(first);
		if(!files.length) return;
		const call = api<R2StoreResult>(this.agent, `/api/${this.folder.split('/')[1]}/store`, {files : files.map(f => sanitize(f, this.outDir))})
			.catch(e => { throw new Error('Upload error: '+(e.message ?? 'Upload permission denied')) })
			.then(r => { if(!r) throw new Error('Upload permission denied.');
				// After the request is completed, assign each file its signed upload URL
				r.keys.forEach((sig,i) => this.uris[files[i]] = `https://${r.r2Base}.r2.cloudflarestorage.com/${sanitize(files[i], this.outDir)}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=${r.key}%2F${r.time.slice(0,8)}%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=${r.time}&X-Amz-Expires=300&X-Amz-Signature=${sig}&X-Amz-SignedHeaders=host&x-id=PutObject`);
			});
		// Until finished, assign the running promise as the upload url
		files.forEach(f => this.uris[f] = call);
	}

	private async getUploadUri(f:string) : Promise<string> {
		if(!this.uris[f]) await this.getUploadUris(f);
		if(this.uris[f] instanceof Promise) await this.uris[f];
		return this.uris[f] as string;
	}

	// This makes sure all upload threads are always filled
	private nextBatch() {
		let r = UPLOAD_THREADS - this.running.size;
		while(--r > 0) this.next();
	}

	// Do the next upload thread
	private async next() {
		if(this.running.size >= UPLOAD_THREADS) return;
		const job = this.jobs.shift();
		if(!job) return;
		this.running.set(job, (job instanceof Function ? job() : this.getUploadUri(job).then(uri => this.upload(uri!, job)))
		.catch((e) => {
			const numErrored = (this.errored.get(job) ?? 0) + 1;
			this.errored.set(job, numErrored);
			if(numErrored > NUM_UPLOAD_TRIES)
				throw new Error(`Fatal error: could not ${job instanceof Function ? 'finalize upload' : `upload ${job}`} after ${NUM_UPLOAD_TRIES} tries. (${e?.message ?? 'Error'})`);
			// Try again
			this.jobs.push(job);
		}).then(() => {
			this.running.delete(job)
			if(typeof job == 'string') delete this.uris[job];
			const remaining = this.jobs.length+this.running.size
			if(state?.job) state.update?.(state.job.numUploaded = state.job.numUploads - remaining);
			if(this.oncomplete) state?.log(`Remaining uploads: ${remaining}...`, true);
			if(this.jobs.length) this.nextBatch();
			else if(!remaining) this.oncomplete?.();
		}));
	}

	private async upload(_url:string, path:string) : Promise<void> { return new Promise(async (ok, err) => {
		const url = new URL(_url);
		const blob = await fs.readFile(path);
		if(state?.job) state.job.bytesResult += blob.byteLength;
		const req = https.request({
			host: url.host,
			path: url.pathname+url.search,
			method: 'PUT',
			agent: this.agent,
			headers: {
				'Content-Type': `image/${this.format}`,
				'Content-Length': blob.byteLength,
			}
		}, res => {
			req.destroy();
			if(res.statusCode == 200) ok();
			else err(new Error(res.statusCode+': '+res.statusMessage));
		});
		req.on('error', (e) => {
			req.destroy();
			err(e);
		});
		req.write(blob);
		req.end();
	})}
}

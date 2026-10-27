import type { FormatType, R2StoreResult, State, UploadJobType } from '../types.js';

import { promises as fs } from 'node:fs';
import https from 'https';

import { NUM_UPLOAD_TRIES, SIGNED_URIS, UPLOAD_THREADS } from '../globals.js';
import { api } from './micrioApi.js';
import { sanitize } from './utils.js';

export type UploadUrlProvider = (files:string[]) => Promise<string[]>;

export interface UploaderOptions {
	/** Optional signed URL provider for server-side tilers; when set, the dashboard store API is not used */
	getUploadUrls?: UploadUrlProvider;
}

type UploaderState = Partial<Pick<State, 'account'|'job'|'update'|'log'>>;

/** A session-wide multithreaded uploader to Micrio */
export class Uploader {
	private jobs:UploadJobType[] = [];
	private oncomplete:Function|undefined;
	private onerror:((e:Error)=>void)|undefined;
	private error:Error|undefined;
	private failed = false;
	private uris:{[key:string]:string|Promise<void>} = {};

	running:Map<UploadJobType, Promise<any>> = new Map();
	errored:Map<UploadJobType, number> = new Map();

	constructor(
		public agent:https.Agent,
		private state:UploaderState,
		private folder:string,
		private format:FormatType,
		private outDir:string,
		private opts:UploaderOptions = {}
	) {
		this.outDir = sanitize(outDir, outDir);
	}

	/** This is called for each individual resulting tile of an image operation
	 * Or the final function to send the succesful status to Micrio after all tiles
	 * of an image have been uploaded.
	 */
	add(jobs:UploadJobType[]) {
		if(this.failed) return;
		this.jobs.push(...jobs);
		if(this.state.job) this.state.update?.(this.state.job.numUploads += jobs.length);
		this.nextBatch();
	}

	/** Async function to await queue upload completion */
	complete() : Promise<void> {
		if(this.failed) return Promise.reject(this.error);
		return new Promise((ok, err) => {
			if(this.jobs.length+this.running.size == 0) return ok();
			this.oncomplete = ok;
			this.onerror = err;
		});
	}

	/** Get signed R2 upload URLs for the next batch of queued file uploads */
	private getUploadUris(first?:string) : void {
		const files = this.jobs.filter((t): t is string => typeof t == 'string' && !this.uris[t]).slice(0, SIGNED_URIS - (first ? 1 : 0));
		if(first) files.unshift(first);
		if(!files.length) return;
		const rel = files.map(f => sanitize(f, this.outDir));

		let urls:Promise<string[]>;
		const provider = this.opts.getUploadUrls;
		if(provider) {
			urls = Promise.resolve().then(() => provider(rel));
		}
		else {
			if(!this.state.account) throw new Error('Upload error: No Micrio account');
			urls = api<R2StoreResult>(this.state.account, this.agent, `/../${this.folder.split('/')[1]}/store`, {files : rel})
				.then(r => {
					if(!r) throw new Error('Upload permission denied.');
					return r.keys.map((sig,i) =>
						`https://${r.r2Base}.r2.cloudflarestorage.com/${rel[i]}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=${r.key}%2F${r.time.slice(0,8)}%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=${r.time}&X-Amz-Expires=3600&X-Amz-Signature=${sig}&X-Amz-SignedHeaders=host&x-id=PutObject`
					);
				});
		}

		const call = urls
			.catch(e => { throw new Error('Upload error: '+(e?.message ?? 'Upload permission denied')) })
			.then(urls => {
				if(urls.length != files.length) throw new Error(`Upload error: expected ${files.length} upload URLs, got ${urls.length}`);
				urls.forEach((url,i) => this.uris[files[i]] = url);
			});

		// Until finished, assign the running promise as the upload url
		files.forEach(f => this.uris[f] = call);
	}

	/** Get an indivual file/tile uploadUrl */
	private async getUploadUri(f:string) : Promise<string> {
		if(!this.uris[f]) this.getUploadUris(f);
		if(this.uris[f] instanceof Promise) await this.uris[f];
		return this.uris[f] as string;
	}

	/** This makes sure all upload threads are always filled */
	private nextBatch() {
		if(this.failed) return;
		let r = UPLOAD_THREADS - this.running.size;
		while(--r > 0) this.next();
	}

	/** Do the next upload thread */
	private async next() {
		if(this.failed || this.running.size >= UPLOAD_THREADS) return;
		const job = this.jobs.shift();
		if(!job) return;
		this.running.set(job, (job instanceof Function ? job()
			: typeof job == 'string' ? this.getUploadUri(job).then(uri => this.upload(uri!, job))
			: this.getUploadUri(job.path).then(uri => this.upload(uri!, job.path, job.blob))
		).catch((e:any) => {
			// Could not get upload URLs -- immediately kill
			if(e?.message?.startsWith('Upload error: ')) { this.fail(e); return; }
			const numErrored = (this.errored.get(job) ?? 0) + 1;
			this.errored.set(job, numErrored);
			if(numErrored > NUM_UPLOAD_TRIES) {
				this.fail(new Error(`Fatal error: could not ${job instanceof Function ? 'finalize upload' : `upload ${job}`} after ${NUM_UPLOAD_TRIES} tries. (${e?.message ?? 'Error'})`));
				return;
			}
			// Try again
			this.jobs.push(job);
		}).then(() => {
			this.running.delete(job);
			if(typeof job == 'string') delete this.uris[job];
			else if(!(job instanceof Function)) delete this.uris[job.path];
			if(this.failed) return;
			const remaining = this.jobs.length+this.running.size;
			if(this.state.job) this.state.update?.(this.state.job.numUploaded = this.state.job.numUploads - remaining);
			if(this.oncomplete) this.state.log?.(`Remaining uploads: ${remaining}...`, true);
			if(this.jobs.length) this.nextBatch();
			else if(!remaining) this.oncomplete?.();
		}));
	}

	private fail(e:any) {
		if(this.failed) return;
		this.failed = true;
		this.error = e instanceof Error ? e : new Error(e?.message ?? String(e));
		this.onerror?.(this.error!);
	}

	/** Individual file / tile upload */
	private async upload(_url:string, path:string, _blob?:Uint8Array) : Promise<void> {
		const url = new URL(_url);
		const blob:Buffer|Uint8Array = _blob ?? await fs.readFile(path);
		if(this.state.job) this.state.job.bytesResult += blob.byteLength;
		const headers:{[key:string]:string|number} = {
			'Content-Type': _blob ? 'application/octet-stream' : this.format == 'jpg' ? 'image/jpeg' : `image/${this.format}`,
			'Content-Length': blob.byteLength,
			'Cache-Control': 'public, max-age=31536000',
		};
		if(url.hostname.endsWith('.blob.core.windows.net')) headers['x-ms-blob-type'] = 'BlockBlob';

		return new Promise((ok, err) => {
			const req = https.request({
				host: url.host,
				path: url.pathname+url.search,
				method: 'PUT',
				agent: this.agent,
				headers
			}, res => {
				req.destroy();
				if(res.statusCode && res.statusCode >= 200 && res.statusCode < 300) ok();
				else err(new Error(res.statusCode+': '+res.statusMessage));
			});
			req.on('error', (e) => {
				req.destroy();
				err(e);
			});
			req.write(blob);
			req.end();
		});
	}
}

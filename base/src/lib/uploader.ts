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

export interface UploadBatchStats {
	/** When the image's tiles were queued */
	queuedAt:number;
	/** When the first tile of the image was dispatched (signing + queue wait is before this) */
	firstUploadAt?:number;
	/** When the last tile of the image finished uploading */
	completedAt:number;
}

interface UploadBatch {
	remaining:number;
	onComplete?:(stats:UploadBatchStats) => void|Promise<void>;
	queuedAt:number;
	firstUploadAt?:number;
}

/** A session-wide multithreaded uploader to Micrio */
export class Uploader {
	private jobs:UploadJobType[] = [];
	private oncomplete:Function|undefined;
	private onerror:((e:Error)=>void)|undefined;
	private error:Error|undefined;
	private failed = false;
	private uris:{[key:string]:string|Promise<void>} = {};
	/** Per-image batches whose onComplete only runs when all their uploads succeeded */
	private batches:Map<UploadJobType, UploadBatch> = new Map();
	private finalizing:number = 0;
	private stats = { done:0, bytes:0, maxInFlight:0 };
	private statsLogAt = Date.now();
	private statsLogDone = 0;
	private statsLogBytes = 0;

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

	/** This is called for each individual resulting tile of an image operation.
	 * When onComplete is given it runs only after every job of this call succeeded,
	 * which is what makes "image ready" trustworthy: no tile can still be uploading.
	 */
	add(jobs:UploadJobType[], onComplete?:(stats:UploadBatchStats) => void|Promise<void>) {
		if(this.failed) return;
		if(onComplete) {
			if(!jobs.length) {
				this.finalizing++;
				this.runFinalizer({ remaining: 0, onComplete, queuedAt: Date.now() });
				return;
			}
			const batch:UploadBatch = { remaining: jobs.length, onComplete, queuedAt: Date.now() };
			for(const job of jobs) this.batches.set(job, batch);
		}
		this.jobs.push(...jobs);
		if(this.state.job) this.state.update?.(this.state.job.numUploads += jobs.length);
		this.nextBatch();
	}

	/** Async function to await queue upload completion */
	complete() : Promise<void> {
		if(this.failed) return Promise.reject(this.error);
		return new Promise((ok, err) => {
			if(this.pending == 0) {
				this.logUploadStats(true);
				return ok();
			}
			this.oncomplete = ok;
			this.onerror = err;
		});
	}

	private get pending() : number {
		return this.jobs.length + this.running.size + this.finalizing;
	}

	private checkComplete() : void {
		if(this.failed) return;
		const remaining = this.pending;
		if(this.state.job) this.state.update?.(this.state.job.numUploaded = this.state.job.numUploads - remaining);
		if(this.oncomplete) this.state.log?.(`Remaining uploads: ${remaining}...`, true);
		if(this.jobs.length) this.nextBatch();
		else if(!remaining) {
			// Only write the summary once, at the end of the whole job
			if(this.oncomplete) this.logUploadStats(true);
			this.oncomplete?.();
		}
	}

	private logUploadStats(force:boolean = false) : void {
		const now = Date.now();
		const secs = (now - this.statsLogAt) / 1000;
		if(!force && secs < 10) return;
		const done = this.stats.done - this.statsLogDone;
		const bytes = this.stats.bytes - this.statsLogBytes;
		const mbytes = bytes / 1048576;
		this.state.log?.(`Uploads: ${done} tiles / ${mbytes.toFixed(1)} MB in ${secs.toFixed(1)}s (${(mbytes / Math.max(secs, 0.001)).toFixed(1)} MB/s), max ${this.stats.maxInFlight} in flight`, true);
		this.statsLogAt = now;
		this.statsLogDone = this.stats.done;
		this.statsLogBytes = this.stats.bytes;
	}

	private batchJobDone(job:UploadJobType) : void {
		const batch = this.batches.get(job);
		if(!batch) return;
		this.batches.delete(job);
		if(--batch.remaining > 0) return;
		if(batch.onComplete) {
			this.finalizing++;
			this.runFinalizer(batch);
		}
	}

	private runFinalizer(batch:UploadBatch) : void {
		const finish = async () : Promise<void> => {
			for(let attempt=0; ; attempt++) {
				try {
					await batch.onComplete!({
						queuedAt: batch.queuedAt,
						firstUploadAt: batch.firstUploadAt,
						completedAt: Date.now()
					});
					return;
				}
				catch(e:any) {
					if(attempt >= NUM_UPLOAD_TRIES) {
						this.fail(new Error(`Fatal error: could not finalize upload after ${NUM_UPLOAD_TRIES} tries. (${e?.message ?? 'Error'})`));
						return;
					}
					await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
				}
			}
		};
		finish().finally(() => {
			this.finalizing--;
			this.checkComplete();
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
		const batch = this.batches.get(job);
		if(batch && batch.firstUploadAt == null) batch.firstUploadAt = Date.now();
		this.stats.maxInFlight = Math.max(this.stats.maxInFlight, this.running.size + 1);
		let succeeded = false;
		const upload = job instanceof Function ? Promise.resolve().then(job)
			: typeof job == 'string' ? this.getUploadUri(job).then(uri => this.upload(uri!, job))
			: this.getUploadUri(job.path).then(uri => this.upload(uri!, job.path, job.blob));
		this.running.set(job, upload.then(() => {
			succeeded = true;
		}).catch((e:any) => {
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
			if(succeeded) this.batchJobDone(job);
			this.checkComplete();
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
				// Drain and let the keep-alive agent reuse the socket; destroying it here
				// forced a fresh DNS lookup + TCP + TLS handshake for every tile.
				res.resume();
				if(res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
					this.stats.done++;
					this.stats.bytes += blob.byteLength;
					this.logUploadStats();
					ok();
				}
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

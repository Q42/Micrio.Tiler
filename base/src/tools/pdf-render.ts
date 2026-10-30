import { Worker } from 'node:worker_threads';

export interface RenderedPage {
	/** Render + encode + write time reported by the worker */
	ms: number;
	bytes: number;
}

/**
 * Drives the PDF render worker. Rendering/encoding a large page blocks a Node event loop for
 * seconds; on the main thread that starves tile uploads (all HTTP callbacks wait). The worker
 * owns its own event loop, so the main thread stays responsive while pages are rendered.
 */
export class PdfRenderWorker {
	private worker: Worker;
	private readyPromise: Promise<number>;
	private resolveReady!: (pages:number) => void;
	private rejectReady!: (e:Error) => void;
	private pending?: { resolve:(page:RenderedPage) => void; reject:(e:Error) => void };

	constructor(file:string, scale:number) {
		this.worker = new Worker(new URL('./pdf-render-worker.js', import.meta.url), {
			workerData: { path: file, scale }
		});
		this.readyPromise = new Promise<number>((resolve, reject) => {
			this.resolveReady = resolve;
			this.rejectReady = reject;
		});
		this.worker.on('message', (msg:any) => {
			if(msg.type === 'ready') return this.resolveReady(msg.pages);
			if(msg.type === 'fatal') {
				const error = new Error(msg.message ?? 'PDF render worker failed');
				this.rejectReady(error);
				this.pending?.reject(error);
				this.pending = undefined;
				return;
			}
			if(!this.pending) return;
			const pending = this.pending;
			this.pending = undefined;
			if(msg.type === 'rendered') pending.resolve({ ms: msg.ms, bytes: msg.bytes });
			else pending.reject(new Error(msg.message ?? 'PDF render failed'));
		});
		this.worker.on('error', (e:Error) => {
			this.rejectReady(e);
			this.pending?.reject(e);
			this.pending = undefined;
		});
		this.worker.on('exit', (code:number) => {
			if(code === 0) return;
			const error = new Error(`PDF render worker exited (${code})`);
			this.rejectReady(error);
			this.pending?.reject(error);
			this.pending = undefined;
		});
	}

	get ready() : Promise<number> {
		return this.readyPromise;
	}

	render(index:number, file:string) : Promise<RenderedPage> {
		if(this.pending) return Promise.reject(new Error('PDF render already in progress'));
		return new Promise<RenderedPage>((resolve, reject) => {
			this.pending = { resolve, reject };
			this.worker.postMessage({ type: 'render', index, file });
		});
	}

	terminate() : Promise<number> {
		this.pending = undefined;
		return this.worker.terminate();
	}
}

import { parentPort, workerData } from 'node:worker_threads';
import { PdfRenderer } from './pdf-renderer.js';

/** Renders PDF pages in a worker thread so the main event loop stays free for tiling and uploads. */

interface WorkerData {
	path: string;
	scale: number;
}

type RenderRequest = { type: 'render'; index: number; file: string };
type CloseRequest = { type: 'close' };
type Request = RenderRequest | CloseRequest;

async function main() : Promise<void> {
	if(!parentPort) throw new Error('PDF worker requires a parent port');
	const port = parentPort;
	const data = workerData as WorkerData;

	const renderer = await PdfRenderer.open(data.path, data.scale);

	port.postMessage({ type: 'ready', pages: renderer.pages });

	port.on('message', async (msg:Request) => {
		if(msg.type === 'close') {
			await renderer.close();
			process.exit(0);
		}
		try {
			const rendered = await renderer.render(msg.index, msg.file);
			port.postMessage({ type: 'rendered', index: msg.index, ...rendered });
		} catch(e:any) {
			port.postMessage({ type: 'error', index: msg.index, message: e?.message ?? String(e) });
		}
	});
}

main().catch(e => {
	parentPort?.postMessage({ type: 'fatal', message: e?.message ?? String(e) });
	process.exit(1);
});

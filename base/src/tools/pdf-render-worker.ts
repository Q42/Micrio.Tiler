import { parentPort, workerData } from 'node:worker_threads';
import { promises as fs } from 'node:fs';
import { pdf } from 'pdf-to-img';
import { getPdfWasmUrl } from './pdf.js';

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
	const wasmUrl = getPdfWasmUrl();

	const document = await pdf(data.path, {
		scale: data.scale,
		...(wasmUrl ? { docInitParams: { wasmUrl } } : {})
	} as Parameters<typeof pdf>[1]).catch(e => { throw new Error(`PDF reading error: ${e}`) });

	port.postMessage({ type: 'ready', pages: document.length });

	port.on('message', async (msg:Request) => {
		if(msg.type === 'close') {
			await document.destroy();
			process.exit(0);
		}
		try {
			const started = Date.now();
			const buffer = await document.getPage(msg.index);
			await fs.writeFile(msg.file, buffer);
			port.postMessage({ type: 'rendered', index: msg.index, ms: Date.now() - started, bytes: buffer.byteLength });
		} catch(e:any) {
			port.postMessage({ type: 'error', index: msg.index, message: e?.message ?? String(e) });
		}
	});
}

main().catch(e => {
	parentPort?.postMessage({ type: 'fatal', message: e?.message ?? String(e) });
	process.exit(1);
});

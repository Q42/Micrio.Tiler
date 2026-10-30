import { parentPort, workerData } from 'node:worker_threads';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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

	// Resolve the exact pdfjs-dist copy that pdf-to-img uses. We cannot use pdf-to-img's
	// getPage() here: it never calls page.cleanup() nor destroys the node-canvas surface,
	// so native memory grows by ~50MB per page on large scanned books.
	const pdfToImg = createRequire(import.meta.url).resolve('pdf-to-img');
	const pdfjsPackage = createRequire(pdfToImg).resolve('pdfjs-dist/package.json');
	const pdfjsPath = path.dirname(pdfjsPackage);
	const pdfjs:any = await import(pathToFileURL(path.join(pdfjsPath, 'legacy/build/pdf.mjs')).href);

	const document = await pdfjs.getDocument({
		standardFontDataUrl: path.join(pdfjsPath, 'standard_fonts') + path.sep,
		cMapUrl: path.join(pdfjsPath, 'cmaps') + path.sep,
		cMapPacked: true,
		...(wasmUrl ? { wasmUrl } : {}),
		isEvalSupported: false,
		data: new Uint8Array(await fs.readFile(data.path))
	}).promise.catch((e:any) => { throw new Error(`PDF reading error: ${e}`) });

	port.postMessage({ type: 'ready', pages: document.numPages });

	port.on('message', async (msg:Request) => {
		if(msg.type === 'close') {
			await document.destroy();
			process.exit(0);
		}
		try {
			const started = Date.now();
			const page = await document.getPage(msg.index);
			const viewport = page.getViewport({ scale: data.scale });
			const canvas = document.canvasFactory.create(viewport.width, viewport.height);
			let buffer:Buffer;
			try {
				await page.render({ canvas: canvas.canvas, viewport }).promise;
				buffer = canvas.canvas.toBuffer('image/png');
			} finally {
				// Release the decoded page image data and the Cairo surface right away
				page.cleanup();
				document.canvasFactory.destroy(canvas);
			}
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

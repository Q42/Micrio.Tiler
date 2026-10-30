import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getPdfWasmUrl } from './pdf.js';

export interface RenderedPage {
	ms: number;
	bytes: number;
}

/**
 * Renders PDF pages with pdfjs directly (not pdf-to-img's getPage(), which never calls
 * page.cleanup() and leaks the node-canvas surface: ~50MB of native memory per page).
 * Shared by the server worker and the in-process CLI/GUI tiler.
 */
export class PdfRenderer {
	private constructor(
		private doc:any,
		private scale:number
	) {}

	static async open(file:string, scale:number) : Promise<PdfRenderer> {
		// Resolve the exact pdfjs-dist copy that pdf-to-img uses
		const pdfToImg = createRequire(import.meta.url).resolve('pdf-to-img');
		const pdfjsPackage = createRequire(pdfToImg).resolve('pdfjs-dist/package.json');
		const pdfjsPath = path.dirname(pdfjsPackage);
		const pdfjs:any = await import(pathToFileURL(path.join(pdfjsPath, 'legacy/build/pdf.mjs')).href);
		const wasmUrl = getPdfWasmUrl();

		const doc = await pdfjs.getDocument({
			standardFontDataUrl: path.join(pdfjsPath, 'standard_fonts') + path.sep,
			cMapUrl: path.join(pdfjsPath, 'cmaps') + path.sep,
			cMapPacked: true,
			...(wasmUrl ? { wasmUrl } : {}),
			isEvalSupported: false,
			data: new Uint8Array(await fs.readFile(file))
		}).promise.catch((e:any) => { throw new Error(`PDF reading error: ${e}`) });

		return new PdfRenderer(doc, scale);
	}

	get pages() : number {
		return this.doc.numPages;
	}

	async render(index:number, file:string) : Promise<RenderedPage> {
		const started = Date.now();
		const page = await this.doc.getPage(index);
		const viewport = page.getViewport({ scale: this.scale });
		const canvas = this.doc.canvasFactory.create(viewport.width, viewport.height);
		let buffer:Buffer;
		try {
			await page.render({ canvas: canvas.canvas, viewport }).promise;
			buffer = canvas.canvas.toBuffer('image/png');
		} finally {
			// Release the decoded page image data and the Cairo surface right away
			page.cleanup();
			this.doc.canvasFactory.destroy(canvas);
		}
		await fs.writeFile(file, buffer);
		return { ms: Date.now() - started, bytes: buffer.byteLength };
	}

	async close() : Promise<void> {
		await this.doc.destroy();
	}
}

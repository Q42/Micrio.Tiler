// PORTED from https://www.npmjs.com/package/pdf-img-convert
// Since it's outdated

//import { getDocument, GlobalWorkerOptions, PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, RenderParameters } from 'pdfjs-dist/types/src/display/api.js';

import * as Canvas from 'canvas';

// Canvas Factory for Node.js
class NodeCanvasFactory {
	create(width:number, height:number) {
		//assert(width > 0 && height > 0, "Invalid canvas size");
		const canvas = Canvas.createCanvas(width, height);
		const context = canvas.getContext("2d");
		return {
			canvas: canvas,
			context: context,
		};
	}

	reset(canvasAndContext:any, width:number, height:number) {
		//assert(canvasAndContext.canvas, "Canvas is not specified");
		//assert(width > 0 && height > 0, "Invalid canvas size");
		canvasAndContext.canvas.width = width;
		canvasAndContext.canvas.height = height;
	}

	destroy(canvasAndContext:any) {
		//assert(canvasAndContext.canvas, "Canvas is not specified");
		canvasAndContext.canvas.width = 0;
		canvasAndContext.canvas.height = 0;
		canvasAndContext.canvas = null;
		canvasAndContext.context = null;
	}
}

export interface PDFConvertOptions {
	scale?: number;
	width?: number;
	height?: number;
	page_numbers?: number[];
}

const importPdfLib = () => import('pdfjs-dist/legacy/build/pdf.mjs');

// Main conversion function
export async function parsePDF(file:string, conversion_config:PDFConvertOptions = {}) : Promise<Uint8Array[]> {
	const pdf = await importPdfLib();

	// Set the full path to the worker
	// Crucial for ES6 module-based frameworks such as Next.js
	pdf.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';

	//const pdfData = new Uint8Array(fs.readFileSync(file));
	const pdfDocument:PDFDocumentProxy = await pdf.getDocument({ url: file, disableFontFace: false, verbosity: 0 }).promise;
	const canvasFactory = new NodeCanvasFactory();

	if (conversion_config.height && conversion_config.width && (conversion_config.height <= 0 || conversion_config.width <= 0)) {
		console.error("Negative viewport dimension given. Defaulting to 100% scale.");
	}

	const pageNumbers = conversion_config.page_numbers || Array.from({ length: pdfDocument.numPages }, (_, i) => i + 1);

	// Process pages in parallel
	const pagePromises = pageNumbers.map(pageNo => docRender(
		pdfDocument, pageNo, canvasFactory, conversion_config)
		.then(currentPage => currentPage ? new Uint8Array(currentPage) : undefined)
	);

	return Promise.all(pagePromises).then(r => r.filter(p => !!p));
}

// Render PDF pages
async function docRender(pdfDocument:PDFDocumentProxy, pageNo:number, canvasFactory:NodeCanvasFactory, conversion_config:PDFConvertOptions) {
	if (pageNo < 1 || pageNo > pdfDocument.numPages) {
		console.error("Invalid page number " + pageNo);
		return;
	}

	if (conversion_config.scale && conversion_config.scale <= 0) {
		console.error("Invalid scale " + conversion_config.scale);
		return;
	}

	const page = await pdfDocument.getPage(pageNo);
	const outputScale = conversion_config.scale || 1.0;
	const viewport = page.getViewport({ scale: outputScale, });

	const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);
	const renderContext:RenderParameters = {
		// @ts-ignore
		canvasContext: canvasAndContext.context,
		viewport,
		canvasFactory,
	};

	await page.render(renderContext).promise;
	const image = canvasAndContext.canvas.toBuffer();

	// Properly destroy canvas resources
	canvasFactory.destroy(canvasAndContext);

	return image;
}

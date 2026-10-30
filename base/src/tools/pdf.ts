import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * pdf.js decodes JPEG2000 (JPXDecode) and JBIG2 page images with WebAssembly modules that ship
 * inside `pdfjs-dist/wasm`. In Node those are read straight from disk, and `pdf-to-img` only
 * forwards `cMapUrl` and `standardFontDataUrl` — never `wasmUrl` — so pdf.js falls back to its
 * CWD-relative default of `wasm/`. That path does not exist, the wasm fails to instantiate, the
 * pure-JS fallback cannot be imported either, and every scanned page comes out blank with
 * `JpxError: OpenJPEG failed to initialize`.
 *
 * Since pdf-to-img 6.x / pdfjs-dist 5.x this affects all Internet Archive style scans (JPX + JBIG2).
 * Resolve the exact pdfjs-dist copy that pdf-to-img itself loads and point pdf.js at its wasm folder.
 */
let pdfWasmUrl:string|undefined|null = null;
export function getPdfWasmUrl():string|undefined {
	if(pdfWasmUrl !== null) return pdfWasmUrl || undefined;
	try {
		const pdfToImg = createRequire(import.meta.url).resolve('pdf-to-img');
		const pdfjsPackage = createRequire(pdfToImg).resolve('pdfjs-dist/package.json');
		// pdf.js requires a trailing slash on factory URLs; normalise separators for Windows
		pdfWasmUrl = path.join(path.dirname(pdfjsPackage), 'wasm').split(path.sep).join('/') + '/';
	} catch(e) {
		// Fall back to the previous behaviour (only breaks JPX/JBIG2 pages)
		pdfWasmUrl = '';
	}
	return pdfWasmUrl || undefined;
}

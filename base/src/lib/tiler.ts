import type { FormatType, ImageInfo, ImageType, State, TileResult } from '../types.js';
import type { Uploader } from './uploader.js';

import path from 'path';
import sharp from 'sharp';

import { promises as fs } from 'node:fs';

import { fsExists, sanitize, walkSync } from './utils.js';
import { api } from './micrioApi.js';

// Detect a PDFjs generated page
const pdfPageRx = /^(.*\.pdf)\.(\d+)\.(png|tif)$/;

/** Process an image to be uploaded to Micrio */
export async function process(
	state:State,
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
		watermarkUrl?:string;
	} = {}
) : Promise<ImageInfo> {
	const isOmni = type=='omni';
	const isPdfPage = pdfPageRx.test(f);

	if(!await fsExists(f)) throw new Error(`File '${f}' not found`);

	const fName = isPdfPage ? path.basename(f).replace(/\.(tif|png)$/,'') : path.basename(f);

	const res = opts.omniId ? {id: opts.omniId} : await api<{id:string}>(state.account, uploader.agent, 'POST', `${folder}/create`,{
		name: encodeURIComponent(fName), type, format
	});
	if(!res) throw new Error('Could not create image in Micrio! Do you have the correct permissions?');

	outDir = sanitize(outDir,outDir)
	const baseDir = path.join(outDir, res.id, isOmni ? opts.omniFrame.toString() : '');

	const {width, height} = await tile(state, baseDir, f, format);
	if(!height || !width) throw new Error('Could not read image dimensions');

	// If this is an extracted PNG file out of an original PDF file, we no longer need it
	if(isPdfPage) await fs.rm(f);

	// Sharp (libvips) always puts the tiles in `name_files` -- rename to our standard
	await fs.rename(baseDir+'_files', baseDir);
	// Delete libvips output meta data file, not needed
	await fs.rm(path.join(baseDir, 'vips-properties.xml'));
	// Remove the libvips-generated deepzoom meta file
	await fs.rm(baseDir+'.dzi');

	if(opts.watermarkUrl)
		await watermarkTiles(state, baseDir, opts.watermarkUrl);

	// Update status to Micrio
	// `omniId` is only defined for the SECOND and later frames of an omni object
	// So the first frame of an omni object will do this call.
	if(!opts.omniId) await api(state.account, uploader.agent, 'POST', `${folder}/@${res.id}/status`, {
		width, height, status: 6, format, length: opts.omniTotalFrames
	});

	// Get all tiles from all subfolders of the output directory
	uploader.add(await walkSync(baseDir));

	// Add a final Uploader job to set the Micrio image status to Completed (4)
	// TODO: It's possible that this function is called if there are still ongoing tile uploads
	// of this image. Fix this by adding a separate `oncomplete` trigger in Uploader for this individual
	// tiled image, which should trigger this.
	if(type != 'omni') uploader.add([() => api(state.account, uploader.agent, 'POST', `${folder}/@${res.id}/status`, { status: 4 })]);

	return { id: res.id, width, height, baseDir, omniFrame: opts?.omniFrame };
}


/** Do the actual image tiling using Sharp (libvips) */
const tile = (state:State, destDir: string, file:string, format:FormatType) : Promise<TileResult> => new Promise((ok, err) => {
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

async function watermarkTiles(state:State, tilesDir:string, watermarkUrl:string) {
	const allFilePaths = await walkSync(tilesDir);
	const allImagePaths = allFilePaths.filter(f => f.match(/\.jpe?g|webp|jfif|png|pdf|tif$/));

	const watermark = sharp(Buffer.from(await fetch(watermarkUrl).then(resp => resp.arrayBuffer()))).png();

	sharp.cache(false); // Disable sharp cache to avoid race conditions writing+reading to the same file

	let counter = 0;
	// We track the watermark size for each zoom level, so all tiles of the same zoom layer will always have the same size
	const watermarkSizeByZoomLevel: Record<string, number> = {};
	// Loop through all images and watermark them
	for (const filePath of allImagePaths) {
		state.log(`Watermarking ${++counter} / ${allImagePaths.length}...`, true);

		const zoomLevel = filePath.match(/[\\\/](\d+)[\\\/]\w+\.\w+$/)?.[1];
		// const tilePath = path.join(tilesDir, filePath);
		const tile = sharp(filePath);
		const { width, height } = await tile.metadata();

		const maxWatermarkDim = watermarkSizeByZoomLevel[zoomLevel] ??= Math.floor(Math.max(width, height) * .07);
		if (maxWatermarkDim < 1) continue; // If watermark would be smaller than 1px, skip it

		// Resize watermark if needed, or position as desired
		const watermarked = await tile.webp()
		  .composite([{
			input: await watermark
				.resize({width: maxWatermarkDim, height: maxWatermarkDim, fit: 'inside', })
				.toBuffer(),
			left: Math.floor(maxWatermarkDim * .2),
			top: Math.floor(maxWatermarkDim * .2),
		  }])
		  .toBuffer();
  
		await fs.writeFile(filePath, watermarked);
	}

	sharp.cache(true); // Re-enable sharp cache
}

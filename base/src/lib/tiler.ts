import type { FormatType, ImageInfo, ImageType, State, TileResult } from '../types.js';
import type { Uploader } from './uploader.js';

import path from 'path';
import sharp from 'sharp';

import { promises as fs, readdirSync, renameSync } from 'node:fs';

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
	} = {}
) : Promise<ImageInfo> {
	const isOmni = type=='omni';
	const isPdfPage = pdfPageRx.test(f);

	if(!await fsExists(f)) throw new Error(`File '${f}' not found`);

	const fName = isPdfPage ? path.basename(f).replace(/\.(tif|png)$/,'') : path.basename(f);

	const res = opts.omniId ? {id: opts.omniId} : await api<{id:string}>(state.account, uploader.agent, `${folder}/create`,{
		name: encodeURIComponent(fName), type, format
	});
	if(!res) throw new Error('Could not create image in Micrio! Do you have the correct permissions?');

	const info = await tileToDir(isOmni ? `${res.id}/${opts.omniFrame!.toString()}` : res.id, f, outDir, format);
	const { width, height } = info;

	// If this is an extracted PNG file out of an original PDF file, we no longer need it
	if(isPdfPage) await fs.rm(f);

	// Update status to Micrio
	// `omniId` is only defined for the SECOND and later frames of an omni object
	// So the first frame of an omni object will do this call.
	if(!opts.omniId) await api(state.account, uploader.agent, `${folder}/@${res.id}/status`, {
		width, height, status: 6, format, length: opts.omniTotalFrames
	});

	// Get all tiles from all subfolders of the output directory
	uploader.add(await walkSync(info.baseDir));

	// Add a final Uploader job to set the Micrio image status to Completed (4)
	// TODO: It's possible that this function is called if there are still ongoing tile uploads
	// of this image. Fix this by adding a separate `oncomplete` trigger in Uploader for this individual
	// tiled image, which should trigger this.
	if(type != 'omni') uploader.add([() => api(state.account, uploader.agent, `${folder}/@${res.id}/status`, { status: 4 })]);

	return { id: res.id, width, height, baseDir: info.baseDir, omniFrame: opts?.omniFrame };
}

/** Tile an image for an already-created Micrio image and queue its tiles for upload */
export async function processExisting(
	uploader:Uploader,
	id:string,
	f:string,
	outDir:string,
	format:FormatType
) : Promise<ImageInfo> {
	const info = await tileToDir(id, f, outDir, format);
	uploader.add(await walkSync(info.baseDir));
	return info;
}

/** Tile an image to a directory and normalize the output layout */
async function tileToDir(id:string, f:string, outDir:string, format:FormatType) : Promise<ImageInfo> {
	if(!await fsExists(f)) throw new Error(`File '${f}' not found`);

	outDir = sanitize(outDir, outDir);
	const baseDir = path.join(outDir, id);

	// Start from a clean directory: a previous job in this function instance may have failed
	await fs.mkdir(path.dirname(baseDir), { recursive: true });
	await fs.rm(baseDir, { recursive: true, force: true });
	await fs.rm(baseDir+'_files', { recursive: true, force: true });
	await fs.rm(baseDir+'.dzi', { force: true });

	const { width, height } = await tile(undefined, baseDir, f, format);
	if(!height || !width) throw new Error('Could not read image dimensions');

	// Sharp (libvips) always puts the tiles in `name_files` -- rename to our standard
	await fs.rename(baseDir+'_files', baseDir);
	// Delete libvips output meta data file, not needed
	await fs.rm(path.join(baseDir, 'vips-properties.xml'), { force: true });
	// Remove the libvips-generated deepzoom meta file
	await fs.rm(baseDir+'.dzi', { force: true });

	return { id, width, height, baseDir };
}

/** Sharp names jpeg tiles `.jpeg` in its DeepZoom layout; Micrio expects `.jpg` */
const renameTiles = (dir:string, from:string, to:string) : void => {
	for(const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if(entry.isDirectory()) renameTiles(full, from, to);
		else if(entry.name.endsWith(from)) renameSync(full, full.slice(0, -from.length) + to);
	}
};

/** Do the actual image tiling using Sharp (libvips) */
const tile = (state:Pick<State,'job'>|undefined, destDir: string, file:string, format:FormatType) : Promise<TileResult> => new Promise((ok, err) => {
	fs.stat(file).then(s => {
		if(state?.job) state.job.bytesSource += s.size;
		const sharpFormat = format == 'jpg' ? 'jpeg' : format;
		sharp(file, {
			// Manual hard limit at 1,000,000 x 1,000,000 px
			limitInputPixels: 1E6 * 1E6,
			// By default, sharp has a low limit
			unlimited: true
		}).toFormat(sharpFormat, {
			// Default is WebP, and 75 is OK, otherwise it's JPG
			quality: sharpFormat == 'webp' ? 75 : 85
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
			if(error||!info) return err(error??'Could not tile image');
			if(format == 'jpg') try { renameTiles(destDir+'_files', '.jpeg', '.jpg'); } catch(e:any) { return err(e?.message ?? 'Could not rename tiles'); }
			ok(info);
		})
	}).catch(e => err(e?.message ?? 'Could not read file'));
});

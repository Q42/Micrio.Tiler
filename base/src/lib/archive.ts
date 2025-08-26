import { promises as fs } from 'node:fs';
import path from 'path';

import { FormatType, FSFile, ImageInfo, MicrioImageInfo } from '../types.js';
import { walkSync } from './utils.js';

/** Generate a single preloader .bin file containing omni/album image thumbnails */
export async function getArchiveBin(
	outDir:string,
	format:FormatType,
	containerId:string,
	entries:[string, ImageInfo][],
	omniId?: string
) : Promise<Uint8Array> {
	const archiveDir = path.join(outDir, containerId+'_basebin');
	const start = Date.now();
	const isOmni = !!omniId;
	await fs.mkdir(archiveDir);
	const delta = isOmni ? 0 : entries.length > 200 ? 2 : entries.length > 50 ? 1 : 0;
	const albumImages:MicrioImageInfo[] = [];
	for(let [fileName, info] of entries) {
		const level:string = getThumbLevel(info, delta).toString();
		const archiveImgDir = path.join(archiveDir, (info.omniFrame ?? info.id).toString());
		await fs.mkdir(archiveImgDir);
		await fs.rename(path.join(info.baseDir, level), path.join(archiveImgDir, level));
		if(!isOmni) albumImages.push({
			id: info.id,
			width: info.width,
			height: info.height,
			created: start,
			title: fileName,
			isWebP: format == 'webp',
			isPng: format == 'png',
			isDeepZoom: true
		})
	}

	// Files to be included in the binary
	const bundleFiles:FSFile[] = [];

	// For (PDF) album, include static album JSON
	if(!isOmni) bundleFiles.push({
		path: `${containerId}.json`,
		buffer: new Uint8Array(new TextEncoder().encode(JSON.stringify({
			delta,
			images: albumImages
		})))
	});

	// Add the tiles
	await walkSync(archiveDir).then(async files => { for(const f of files) bundleFiles.push({
		path: f.replace(/\\/g,'/').replace(/^.*_basebin\//,''),
		buffer: await fs.readFile(f)
	})});

	return generateMDP(bundleFiles).arrayBuffer().then(r => new Uint8Array(r));
}

function getThumbLevel(info:ImageInfo, delta:number) : number {
	let d = Math.max(info.width, info.height), l = delta;
	while(d > 1024) { d /= 2; l++; }
	let dzLevels = 0, max = Math.max(info.width, info.height);
	do dzLevels++; while ((max /= 2) > 1);
	return dzLevels - l;
}

function generateMDP(files:FSFile[]) : Blob {
	const enc = new TextEncoder();
	const arr:Uint8Array[] = [];
	files.forEach(i => {
		if(!i.buffer || !i.path) return;
		const name = enc.encode(i.path); // byte[20]
		const size = i.buffer.byteLength.toString(8); // byte[12]
		arr.push(name, new Uint8Array(20 - name.byteLength));
		arr.push(enc.encode('0'.repeat(12 - size.length)+size));
		arr.push(i.buffer);
	});

	return new Blob(arr as BlobPart[], {type: 'application/octet-stream'});
}

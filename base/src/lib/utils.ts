import { promises as fs } from 'node:fs';
import path from 'path';

export const sanitize = (f:string, outDir:string) : string => f.replace(/\\+/g,'/').replace(outDir+'/','');

/** Check if a file exists */
export const fsExists = async (filePath:string) : Promise<boolean> => {
	try {
		await fs.access(filePath);
		return true; // File exists
	} catch (error) {
		return false; // File does not exist
	}
};

/** Walk through a directory and all of its recursive subdirectories and return all files in it */
export async function walkSync(name:string) : Promise<string[]> {
	const ret:string[] = [], entry = await fs.lstat(name).catch(() => {});
	if(entry) if(entry.isDirectory()) for (const file of await fs.readdir(name))
		ret.push(...await walkSync(path.join(name, file)))
	else ret.push(name)
	return ret;
}

/** Convert a julian date to a timestamp */
export const jdToTime = (jd:number) : number => Math.floor((jd - 2440587.5) * 86400000);

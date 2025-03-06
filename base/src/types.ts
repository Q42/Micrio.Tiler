export interface R2StoreResult {
	time: string;
	key: string;
	account: string;
	r2Base: string;
	keys: string[];
};

export type FormatType = ('jpg'|'webp'|'png');
export type ImageType = ('2d'|'360'|'omni');

export interface ImageInfo {
	id: string;
	width: number;
	height: number;
	baseDir: string;
	omniFrame?: number;
};

export interface MicrioImageInfo {
	id: string;
	width: number;
	height: number;
	created: number;
	title: string;
	isWebP: boolean;
	isPng: boolean;
	isDeepZoom: boolean;
}

export interface TileJob {
	status: string;
	started: number;
	numUploads: number;
	numUploaded: number;
	numProcessed: number;
	bytesSource: number;
	bytesResult: number;
}

export interface TileResult {
	width: number;
	height: number;
}

export interface UserToken {
	email: string;
	base64: string;
	expires: Date;
	groupSlug?: string;
}
export interface LoginStatusResult {
	status: ('ok'|'wait'|'error');
	token?: UserToken;
}

export type Logger = (str?:string, overwrite?:boolean) => void;

export interface State {
	/** The logged in user account */
	account: UserToken;
	/** Log output */
	log: Logger;
	/** [GUI] Optional tile job state object */
	job?: TileJob;
	/** [GUI] Optional state updater */
	update?: (a:any) => void;
}

export type CustomUploadJob = {
	blob: Uint8Array;
	path: string;
}
export type UploadJobType = string|CustomUploadJob|(() => Promise<any>);

export interface PDFAlbumResult {
	id:string;
	slug:string;
	created:number;
}

export interface FSFile {
	path: string;
	buffer: Buffer|Uint8Array;
}

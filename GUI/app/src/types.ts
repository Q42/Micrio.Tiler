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
};

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

export interface UIState {
	/** Your logged in Micrio account */
	account?: string;
	/** The names of selected files to process */
	files: string[];
	/** The dashboard destination URL which has the groupSlug and target folder */
	destination?: string;
	/** The raw tiling cli terminal output to be shown during the tiling process */
	terminal: string;
	/** Target tile format (jpg, webp, png, defaults to webp) */
	format: FormatType;
	/** Type of image: 2d, omni or 360
	 * If the target folder is a Spaces 360 folder, the image will automatically be 360  */
	type: ImageType;
	/** The login tokenized URL when not logged in */
	loginUrl?: string;
	/** Any error that will be displayed in the UI */
	error?: string;
	/** The available groups for a logged in user */
	groups?: Group[];
	/** The selected group slug */
	groupSlug?: string;
	/** Current tiling job (can be multiple images) */
	job?: {
		status: string;
		started: number;
		numUploads: number;
		numUploaded: number;
		numProcessed: number;
		bytesSource: number;
		bytesResult: number;
	}
}

export interface Group {
	name: string;
	slug: string;
	hasOmni?: boolean;
	folders?: Folder[],
}

export interface Folder {
	name: string;
	slug: string;
	children: Folder[];
}

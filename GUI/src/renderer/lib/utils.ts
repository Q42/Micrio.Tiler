// Bytes to readable format
//https://stackoverflow.com/questions/15900485/correct-way-to-convert-size-in-bytes-to-kb-mb-gb-in-javascript
export function formatBytes(bytes:number, decimals:number = 2) {
	if (!+bytes) return '0B'

	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k))

	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

// Seconds to readable h:m:s format
export function formatDuration(s:number) : string {
	const h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
	return (h?(h+':'+(m<10?'0':'')):'')+(h||m?(m+':'):'')+(s>=60&&(s=s%60)<10?'0':'')+Math.round(s);
}


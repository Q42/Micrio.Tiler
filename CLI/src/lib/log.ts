export function log(str:string='', overwrite:boolean=false) {
	if(overwrite) {
		process.stdout.cursorTo(0);
		process.stdout.clearLine(1);
	}
	process.stdout.write(str + (!overwrite ? '\n' : '\r'));
}

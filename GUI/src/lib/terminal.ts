import { UIState } from "../types.js";

export class Terminal {
    private lines:string[] = [];

    constructor(private state:UIState, private updateState:(s?:any)=>void) { }

    log(str:string='', override:boolean=false) {
        if(this.lines.length && override) this.lines[this.lines.length-1] = str;
        else this.lines.push(str);
        this.state.terminal = this.lines.join('\n');
        this.updateState?.();
    }

    reset() {
        this.lines = [];
    }
}

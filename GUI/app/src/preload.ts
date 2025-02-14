import type { UIState } from './types';

import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
	emit: (cmd:string, value?:any) => void;
	onStateUpdate: (cb:((state:UIState) => void)) => void;
}

const commands:ElectronAPI = {
	emit: (cmd:string, value?:any) => ipcRenderer.send(cmd, value),
	onStateUpdate: (cb:((state:UIState) => void)) => ipcRenderer.on('state', (e, state:UIState) => cb(state)),
}

contextBridge.exposeInMainWorld('electronAPI', commands);

window.addEventListener('DOMContentLoaded', () => {
	ipcRenderer.send('loaded');
});

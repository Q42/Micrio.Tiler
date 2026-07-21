import type { ElectronAPI } from '../../preload';
import type { UIState } from '../../types';

export const API:ElectronAPI = 'electronAPI' in window ? window.electronAPI as ElectronAPI : {
	emit: (cmd:string, value?:string) => console.info('cmd', cmd, value),
	onStateUpdate: (cb:((state:UIState) => void)) => console.info('state'),
};

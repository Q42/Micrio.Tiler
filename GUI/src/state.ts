import type { UIState } from './types.js';

import { conf } from './lib/store.js';

export const state : UIState = {
	account: conf.get('account')?.email,
	terminal: '',
	files: [],
	type: '2d',
	format: 'webp'
}

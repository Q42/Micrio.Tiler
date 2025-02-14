import type { UIState } from './types';

import { conf } from './lib/store';

export const state : UIState = {
	account: conf.get('account')?.email,
	terminal: '',
	files: [],
	type: '2d',
	format: 'webp'
}

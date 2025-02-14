import type { UIState } from '../../app/src/types';

import { state } from './lib/state';

const demoGroups = [
	{
		"name": "ARC",
		"slug": "arc",
		"folders": []
	},
	{
		"name": "Micrio",
		"slug": "micrio",
		"hasOmni": true,
		"folders": [
			{
				"name": "Marcel test 1",
				"slug": "marcel-test-1",
				"children": [
					{
						"name": "Drag&drop",
						"slug": "dragdrop",
						"children": []
					},
					{
						"name": "R2 direct uploads",
						"slug": "r2-direct-uploads",
						"children": []
					}
				]
			},
		]
	}
];

/*
// For local dev */
const demo:UIState = {
	account: 'bla@bla',
	terminal: '',
	destination: 'https://dash.micr.io/micrio/blabla',
	files: ['bla','bla','bla','bla','bla','bla','bla','bla','bla','bla'],
	type: '2d',
	format: 'webp',
	groupSlug: 'micrio',
	groups: demoGroups,
	//loginUrl: '',
	/*job: {
		started: Date.now(),
		status: 'Processing...',
		numProcessed: 5,
		numUploads: 15,
		numUploaded: 3,
		bytesSource: 1024*1024*1024,
		bytesResult: 32*1024*1024
	}*/
};

export default {
	state,
	init: () => state.set(demo),
}

//*/

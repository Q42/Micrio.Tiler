import { IS_STAGING } from '../globals.js';
import type { UserToken } from '../types.js';

import https from 'https';

const urlDashBase = IS_STAGING ? 'https://dash.micrio.dev' : 'https://dash.micr.io';

/**
 * Talk with the Micrio dashboard CLI API (https://dash.micr.io/api/cli/*)
 * @see https://github.com:Q42/Micrio/server/dash.micr.io for the server code (Q42 only -- might open source one day)
 */
export const api = <T>(account: UserToken, agent: https.Agent, method:'POST'|'GET', path:string, data:Object = {}) : Promise<T|undefined> => new Promise((ok, err) => {
	if(!account) return err(new Error('Not logged in'));
	const url = new URL(urlDashBase+'/api/cli'+path);
	const blob = JSON.stringify(data);
	const req = https.request({
		host: url.host,
		path: url.pathname+url.search,
		method,
		agent: agent,
		headers: {
			'Cookie': `.AspNetCore.Identity.Application=${account.base64};`,
			'Content-Type': 'application/json',
			'Content-Length': blob.length
		}
	}, res => {
		const body:Uint8Array[] = [];
		res.on('data', chunk => {
			body.push(chunk);
		})
		.on('end', () => {
			const resp = Buffer.concat(body).toString();
			const b = resp?.startsWith('{') ? JSON.parse(resp) : {};
			if(res.statusCode != 200) {
				const message = res.statusCode == 403 ? 'Access denied' : 'Unknown error';
				err(new Error(`${res.statusCode} ${res.statusMessage}: ${b?.error ?? url.pathname+': '+message}`));
			}
			else ok(b);
			req.destroy();
		});
	});
	req.on('error', (e) => {
		err(e);
		req.destroy();
	});
	req.write(blob);
	req.end();
});

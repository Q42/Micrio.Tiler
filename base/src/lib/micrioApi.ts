import type { UserToken } from '../types.js';

import https from 'https';

const urlDashBase = 'https://dash.micr.io';

/**
 * Talk with the Micrio dashboard CLI API (https://dash.micr.io/api/cli/*)
 * @see https://github.com:Q42/Micrio/server/dash.micr.io for the server code (Q42 only -- might open source one day)
 */
export const api = <T>(account: UserToken, agent: https.Agent, path:string, data:Object) : Promise<T|undefined> => new Promise((ok, err) => {
    if(!account) return err(new Error('Not logged in'));
    const url = new URL(urlDashBase+path);
    const blob = JSON.stringify(data);
    const req = https.request({
        host: url.host,
        path: url.pathname+url.search,
        method: 'POST',
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
            const b = JSON.parse(Buffer.concat(body).toString());
            if(res.statusCode != 200) err(new Error(`${path}: ${res.statusCode} ${res.statusMessage}: ${b?.error ?? 'Unknown error'}`));
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

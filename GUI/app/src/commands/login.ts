import type { LoginStatusResult, UserToken } from '@micrio/tiler-base';

import { urlAccountBase } from '../lib/store.js';

const to = (fn:(()=>any)|undefined,ms:number=1000) : Promise<void> => new Promise(ok => setTimeout(async () => {await fn?.();ok()}, ms));

export const login = (
	sendLoginUrl: (s:string) => void
) : Promise<UserToken> => new Promise(async (ok, err) => {
	const id = crypto.randomUUID();

	async function check() : Promise<LoginStatusResult> { return new Promise(async (ok, err) => { do {
		const resp = await fetch(`${urlAccountBase}/api/cli/${id}/status`).then(r => r?.ok && r.status == 200 ? r.json() : {status:'error'}) as LoginStatusResult;
		if(resp.status == 'ok') return ok(resp);
		else if(resp.status == 'error') return err(resp);
		else await to(undefined, 3000);
	} while(true)})}

	if(await fetch(`${urlAccountBase}/api/cli/${id}/create`).then(r => r.text()) == 'OK') {
		sendLoginUrl(`${urlAccountBase}/cli-login/${id}`);
		check().then((r) => ok(r.token!), err);
	}
	else throw new Error('Something went wrong. Please try again later.');
});

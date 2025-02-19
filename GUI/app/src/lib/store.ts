import type { UserToken } from '@micrio/tiler-base';

const dev = false;
export const conf:Map<string, UserToken|undefined> = new Map();

export const urlAccountBase = dev ? 'http://localhost:6200' : 'https://account.micr.io';
export const urlDashBase = dev ? 'http://localhost:6100' : 'https://dash.micr.io';

import type { Folder, Group, UserToken } from '../types';

import { urlDashBase, conf } from '../lib/store';

interface DBFolder {
	name: string;
	slug: string;
	id: string;
	parentId?: string;
}

interface ApiGroup {
	name: string;
	slug: string;
	id: number[];
	hasOmni?: boolean;
	folders?: DBFolder[];
}

export const getGroups = async () : Promise<Group[]> => {
	const account = conf.get('account') as UserToken;
	if(!account?.email) throw new Error(`Not logged in`);

	const allGroups = await fetch(urlDashBase+'/api/groups?includeFolders', {
		headers: {
			'Cookie': `.AspNetCore.Identity.Application=${account.base64};`,
			'Content-Type': 'application/json',
		}
	}).then(r => {
		if(r.ok && r.status == 200) return r.json() as Promise<ApiGroup[]>;
		else throw new Error('Error ' + r.status)
	});

	if(!allGroups) throw new Error('Error getting groups');

	return allGroups.map(g => ({
		name: g.name,
		slug: g.slug,
		hasOmni: g.hasOmni,
		folders: getChildren(g.folders??[])
	}));
}

const getChildren = (all:DBFolder[], id?:string) : Folder[] =>
	all.filter(f => id ? f.parentId == id : !f.parentId).map(f => ({
		name: f.name,
		slug: f.slug,
		children: getChildren(all, f.id)
	}));

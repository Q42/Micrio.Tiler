import type { UIState } from '../../../app/src/types';

import { writable, type Writable } from 'svelte/store';
import { API } from './api';

export const state:Writable<UIState|undefined> = writable();

API.onStateUpdate((s:UIState) => state.set(s));


interface Notification {id: number; message: string; isError: boolean;}

export const notifications = writable<Notification[]>([]);

export const notify = (message:string, isError:boolean = false) : void => {
	const id = Date.now();
	notifications.update(n => { n.push({id, message, isError}); return n })
	if(!isError) setTimeout(() => notifications.update(n => n.filter(n => n.id != id)), 5000);
};

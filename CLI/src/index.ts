#! /usr/bin/env node

import { type UserToken, upload } from '@micrio/tiler-base';

import { program, Option } from 'commander';
import { conf } from './lib/store.js';
import process from 'process';
import { LIB_VERSION } from './lib/version.js';
import { login } from './commands/login.js';
import { log } from './lib/log.js';

const nodeVersion = Number(process.version.split('.')[0].replace('v',''));
if(isNaN(nodeVersion) || nodeVersion < 18) {
	console.log(`ERROR: Micrio.CLI requires NodeJS v18.17.0+ to run. Your current version is ${process.version}.`);
	console.log('');
	console.log('Please update your NodeJS at https://nodejs.org/');
	process.exit(1);
}

let account = conf.get('account') as UserToken|undefined;

console.log('<> Micrio CLI Tool v'+LIB_VERSION);
console.log();
if(account) {
	console.log('Logged in as ' + account.email)
	console.log();
}

program.name('micrio')
	.description('Local image processing and uploader to the Micrio dashboard')
	.version('Version '+LIB_VERSION);

program.command('login')
	.description('connect to your current Micrio session')
	.action(login);

program.command('logout')
	.description('log out of your Micrio account for this tool')
	.action(() => {
		if(account) {
			conf.delete('account');
			console.log('Succesfully logged out.');
		}
		else console.log('Not logged in.')
	});

import fs from 'fs';

program.command('upload')
	.description('upload your images to the Micrio dashboard')
	.argument('<files>', 'one or more image files, wildcards supported (such as *.jpg)')
	.requiredOption('-d, --destination <url>', 'the Micrio dashboard destination folder URL')
	.addOption(new Option('-f, --format <format>', 'tile format').choices(['webp', 'jpg']).default('webp'))
	.addOption(new Option('-t, --type <type>', 'image type').choices(['2d', '360', 'omni']).default('2d'))
	.addOption(new Option('--pdfScale <scale>', 'PDF scale').default('4'))
	.action((a,b,c) => {
		// You can provide a wildcard in the input files, HOWEVER, it will only seek these files from
		// the CURRENT working directory.
		// TODO: Fix this to also be able to provide a wildcard of other directories
		const allFiles = fs.readdirSync('.').filter(f => !fs.lstatSync(f).isDirectory());
		const args = (c.args ?? []) as string[];
		let files = args.map(f => {
			if(!/\*/.test(f)) return [f]
			const rx = new RegExp(f.replace(/\./g,'\\.').replace(/\*/g,'.+'), 'i');
			return allFiles.filter(f => rx.test(f));
		}).reduce((a, b) => [...a,...b], []).sort((a, b) => a > b ? 1 : a < b ? -1 : 0);
		files = files.filter((f,i) => files.indexOf(f) == i);

		upload(account, b, c, {log}).catch((e:Error) => console.log('Error: ' + e.message));
	});

program.parse();

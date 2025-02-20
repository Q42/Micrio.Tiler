import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

import fs from 'fs';
import path from 'node:path';

const getDirectories = (source:string) =>
	fs.readdirSync(source, { withFileTypes: true })
		.filter(dirent => dirent.isDirectory())
		.map(dirent => dirent.name);

const config: ForgeConfig = {
	packagerConfig: {
		asar: true,
		icon: './public/micrio',
	},
	rebuildConfig: {},
	makers: [new MakerSquirrel({}), new MakerZIP({}, ['darwin']), new MakerRpm({}), new MakerDeb({})],
	plugins: [
		new VitePlugin({
			// `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
			// If you are familiar with Vite configuration, it will look really familiar.
			build: [
				{
					// `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
					entry: 'src/main.ts',
					config: 'vite.main.config.ts',
				},
				{
					entry: 'src/preload.ts',
					config: 'vite.preload.config.ts',
				},
			],
			renderer: [
				{
					name: 'main_window',
					config: 'vite.renderer.config.ts',
				},
			],
		}),
		{
			name: '@electron-forge/plugin-auto-unpack-natives',
			config: {},
		},
		// Fuses are used to enable/disable various Electron functionality
		// at package time, before code signing the application
		new FusesPlugin({
			version: FuseVersion.V1,
			[FuseV1Options.RunAsNode]: false,
			[FuseV1Options.EnableCookieEncryption]: true,
			[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
			[FuseV1Options.EnableNodeCliInspectArguments]: false,
			[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
			[FuseV1Options.OnlyLoadAppFromAsar]: true,
		}),
	],
	hooks: {
		postPackage: async (forgeConfig:any, options:any) => {
			const sourceDir = path.join('..','bin', '@img');
			options.outputPaths.forEach((p:string) => {
				const dir = options.platform == 'darwin' ?
					path.join(p, 'micrio-gui.app', 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules')
					: path.join(p, 'resources', 'app.asar.unpacked', 'node_modules');
				if(fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
				fs.mkdirSync(dir);
				const target = path.join(dir, '@img');
				fs.mkdirSync(target);
				fs.cpSync(sourceDir, target, {recursive: true});

				// Remove all non-matching OS sharp binaries
				getDirectories(target).filter(entry => !entry.match(options.platform)).forEach(entry =>
					fs.rmSync(path.join(target, entry), {recursive: true, force: true})
				);
			});
		}
	}
};

export default config;

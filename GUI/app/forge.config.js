const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

const fs = require('node:fs');
const path = require('node:path');

const getDirectories = source =>
	fs.readdirSync(source, { withFileTypes: true })
		.filter(dirent => dirent.isDirectory())
		.map(dirent => dirent.name);

module.exports = {
	packagerConfig: {
		asar: true,
		icon: './public/micrio',
	},
	rebuildConfig: {},
	makers: [
		{
			name: '@electron-forge/maker-squirrel',
			config: {},
		},
		{
			name: '@electron-forge/maker-zip',
			platforms: ['darwin'],
		},
		{
			name: '@electron-forge/maker-deb',
			config: {},
		},
		{
			name: '@electron-forge/maker-rpm',
			config: {},
		},
	],
	plugins: [
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
		postPackage: async (forgeConfig, options) => {
			const sourceDir = path.join('..','bin', '@img');
			options.outputPaths.forEach(p => {
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

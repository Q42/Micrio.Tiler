import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const appDir = __dirname;

const config: ForgeConfig = {
	packagerConfig: {
		asar: true,
		icon: './public/micrio',
	},
	rebuildConfig: {},
	makers: [new MakerZIP({}, ['darwin', 'linux', 'win32'])],
	plugins: [
		new VitePlugin({
			build: [
				{
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
		postPackage: async (_forgeConfig:any, options:any) => {
			for (const outputPath of options.outputPaths) {
				const resDir = options.platform == 'darwin'
					? path.join(outputPath, 'micrio-gui.app', 'Contents', 'Resources')
					: path.join(outputPath, 'resources');

				const asarPath = path.join(resDir, 'app.asar');

				// 1. Inject UI dist into the asar so the renderer can load it
				if (fs.existsSync(asarPath)) {
					const tmpDir = path.join(resDir, '.asar-tmp');
					fs.rmSync(tmpDir, { recursive: true, force: true });

					execSync(`npx @electron/asar extract "${asarPath}" "${tmpDir}"`, { stdio: 'pipe' });

					// Add UI dist bundle to the renderer output
					const distSource = path.resolve(__dirname, 'dist');
					if (fs.existsSync(distSource)) {
						fs.cpSync(distSource, path.join(tmpDir, '.vite', 'renderer', 'main_window', 'dist'), { recursive: true });
					}

					// Fix loadFile path in main.js to point to the renderer's index.html
					const mainJs = path.join(tmpDir, '.vite', 'build', 'main.js');
					if (fs.existsSync(mainJs)) {
						let code = fs.readFileSync(mainJs, 'utf8');
						code = code.replace('loadFile("index.html")', 'loadFile(".vite/renderer/main_window/index.html")');
						fs.writeFileSync(mainJs, code);
					}

					// Point index.html to the pre-built Tailwind CSS (Vite's renderer build strips custom classes)
					const rendererHtml = path.join(tmpDir, '.vite', 'renderer', 'main_window', 'index.html');
					if (fs.existsSync(rendererHtml)) {
						let html = fs.readFileSync(rendererHtml, 'utf8');
						html = html.replace(/href="\.\/assets\/[^"]+\.css"/, 'href="./dist/micrio.gui.ui.css"');
						fs.writeFileSync(rendererHtml, html);
					}

					fs.rmSync(asarPath);
					execSync(`npx @electron/asar pack "${tmpDir}" "${asarPath}"`, { stdio: 'pipe' });
					fs.rmSync(tmpDir, { recursive: true, force: true });
				}

				// 2. Copy production dependencies into resources/ alongside the asar
				const platform = options.platform;
				const nmDir = path.join(resDir, 'node_modules');
				const appNm = path.resolve(appDir, 'node_modules');

				const isNativeIncluded = (name:string) => {
					const nativePlatforms = ['darwin', 'linux', 'linuxmusl', 'win32'];
					const parts = name.replace(/^(@img|@napi-rs)\//, '').split('-');
					for (const part of parts) {
						if (nativePlatforms.includes(part))
							return part === platform || (platform === 'linux' && part === 'linuxmusl');
					}
					return true;
				};

				const copyPkg = (name:string, seen:Set<string>) => {
					if (seen.has(name) || !isNativeIncluded(name)) return;
					seen.add(name);

					const src = path.join(appNm, name);
					if (!fs.existsSync(src)) return;

					const tgt = path.join(nmDir, name);
					if (fs.existsSync(tgt)) return;
					fs.mkdirSync(path.dirname(tgt), { recursive: true });
					fs.cpSync(src, tgt, { recursive: true });

					// Copy transitive deps (including optional deps for platform-specific packages)
					try {
						const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
						const allDeps = { ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies };
						for (const depName of Object.keys(allDeps)) {
							copyPkg(depName, seen);
						}
					} catch {}
				};

				const pkgJson = JSON.parse(fs.readFileSync(path.resolve(appDir, 'package.json'), 'utf8'));
				const seen = new Set<string>();
				for (const depName of Object.keys(pkgJson.dependencies || {})) {
					copyPkg(depName, seen);
				}
			}
		}
	}
};

export default config;

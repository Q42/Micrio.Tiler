import { MakerZIP } from '@electron-forge/maker-zip';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

import fs from 'node:fs';
import path from 'node:path';

const appDir = __dirname;

// The Vite plugin bundles the app's JS but marks production dependencies as
// `external` and strips them from the packaged package.json, so packager prunes
// them. Native modules (sharp + its platform @img binary, and its deps) can't
// be bundled, so we copy them back into the package. This runs in
// `packageAfterPrune` — after pruning removes them but BEFORE the asar is packed
// and the app is signed, so the native binaries end up inside the signed bundle.
const NATIVE_PLATFORMS = ['darwin', 'linux', 'linuxmusl', 'win32'];
const NATIVE_ARCHES = ['arm64', 'x64', 'arm', 'ia32'];

// Skip prebuilt binaries (e.g. @img/sharp-<platform>-<arch>) that don't match
// the platform/arch being packaged, so we don't ship or sign useless binaries.
const isForThisTarget = (name: string, platform: string, arch: string) => {
	const parts = name.replace(/^(@img|@napi-rs)\//, '').split('-');
	for (const part of parts) {
		if (
			NATIVE_PLATFORMS.includes(part) &&
			part !== platform &&
			!(platform === 'linux' && part === 'linuxmusl')
		)
			return false;
		if (NATIVE_ARCHES.includes(part) && part !== arch) return false;
	}
	return true;
};

const copyProdDeps = (buildPath: string, platform: string, arch: string) => {
	const srcRoot = path.join(appDir, 'node_modules');
	const dstRoot = path.join(buildPath, 'node_modules');
	const rootPkg = JSON.parse(
		fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'),
	);

	const seen = new Set<string>();
	const copy = (name: string) => {
		if (seen.has(name) || !isForThisTarget(name, platform, arch)) return;
		seen.add(name);

		const src = path.join(srcRoot, name);
		if (!fs.existsSync(src)) return;

		const dst = path.join(dstRoot, name);
		if (!fs.existsSync(dst)) {
			fs.mkdirSync(path.dirname(dst), { recursive: true });
			fs.cpSync(src, dst, { recursive: true, dereference: true });
		}

		try {
			const pkg = JSON.parse(
				fs.readFileSync(path.join(src, 'package.json'), 'utf8'),
			);
			for (const dep of Object.keys({
				...pkg.dependencies,
				...pkg.optionalDependencies,
			})) {
				copy(dep);
			}
		} catch {}
	};

	for (const dep of Object.keys(rootPkg.dependencies || {})) copy(dep);
};

const macSigning =
	process.env.APPLE_API_KEY &&
	process.env.APPLE_API_KEY_ID &&
	process.env.APPLE_API_ISSUER
		? {
				osxSign: {},
				osxNotarize: {
					appleApiKey: process.env.APPLE_API_KEY,
					appleApiKeyId: process.env.APPLE_API_KEY_ID,
					appleApiIssuer: process.env.APPLE_API_ISSUER,
				},
			}
		: {};

const config: ForgeConfig = {
	packagerConfig: {
		// Unpack native modules so their binaries live on disk, not inside the
		// asar. sharp's .node dlopens libvips .dylib as a sibling, so the whole
		// @img/@napi-rs/sharp trees (both .node and .dylib) must be unpacked
		// together — unpacking only *.node (the auto-unpack-natives default)
		// leaves the dylib unreadable inside the archive.
		asar: {
			unpack: '**/node_modules/{sharp,@img,@napi-rs}/**',
		},
		icon: './public/micrio',
		appBundleId: 'io.micr.uploader',
		appCategoryType: 'public.app-category.graphics-design',
		...macSigning,
	},
	rebuildConfig: {},
	makers: [
		new MakerZIP({}, ['darwin', 'linux', 'win32']),
	],
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
		packageAfterPrune: async (_config, buildPath, _version, platform, arch) => {
			copyProdDeps(buildPath, platform, arch);
		},
	},
};

export default config;

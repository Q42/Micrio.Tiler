# Micrio Uploader GUI

## Installing
1. Run `pnpm i`
2. Run `npm run install-sharp` to install all cross-platform binaries for the `sharp` package
3. Create a `bin/@img` directory in this parent directory (`../`)
4. Copy the contents of `./node_modules/@img/` to `../bin/@img`
5. Remove all directories in `./node_modules/@img/` that are not for your own development platform

## Developing
1. UI only: run `npm run dev` in `../ui`
2. Make sure to build the UI for every change: `npm run build` in `../ui`
3. Developing app: `npm run start`

## Building

1. Make sure the UI is built and you have at least ran `npm run start` once
2. For Windows, do `npm run [make|package] -- --arch x64 --platform win32`
3. For Mac compiler target, you need to be on a Mac! Do `npm run [make|package] -- --arch universal --platform darwin`. This builds a single app for both `x64` and `arm64`.

`npm run make` generates an entire installable single executable file, where `npm run package` only makes the bundled compiled program.

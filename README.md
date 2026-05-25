# Micrio image processing clients

This is an open source repository for enabling people to process ultra resolution images on their own computer, minimizing any upload and processing times to upload images to Micrio.

Learn more about Micrio at https://micr.io/

This repo is a **pnpm workspace** consisting of:

- `base` The [`@micrio/tiler-base`](https://www.npmjs.com/package/@micrio/tiler-base) package which is the client-side tiler.
- `CLI` The npm [`@micrio/cli`](https://www.npmjs.com/package/@micrio/cli) command-line tool to process your images and upload them to your Micrio account.
- `GUI/app` The graphical user interface (desktop app) to do this.
- `GUI/ui` The Svelte frontend for the desktop app.

## Building

```bash
pnpm install
pnpm build            # builds all packages
pnpm build:cli        # build CLI only
pnpm build:gui        # build Linux GUI zip
pnpm build:gui:win32  # build Windows x64 GUI (requires mono and wine on Linux)
pnpm build:gui:darwin # build macOS universal GUI (must run on a Mac)
```

The GUI output is at `GUI/app/out/make/`.

### Build dependencies

- `zip` — required by all `build:gui:*` commands to create distributable archives


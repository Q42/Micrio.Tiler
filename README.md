# Micrio image processing clients

This is an open source repository for enabling people to process ultra resolution images on their own computer, minimizing any upload and processing times to upload images to Micrio.

Learn more about Micrio at https://micr.io/

## Packages

- `base` The [`@micrio/tiler-base`](https://www.npmjs.com/package/@micrio/tiler-base) package — client-side tiler library.
- `CLI` The [`@micrio/cli`](https://www.npmjs.com/package/@micrio/cli) command-line tool to process and upload images to your Micrio account.
- `GUI/app` The graphical user interface (Electron desktop app).
- `GUI/ui` The Svelte frontend for the desktop app.

## Building the CLI

```bash
cd CLI
pnpm install
pnpm build
```

## Building the GUI

```bash
# 1. Build the base library (also needed by CLI)
cd base && pnpm install && pnpm build

# 2. Install GUI dependencies
cd ../GUI/ui && pnpm install
cd ../app && pnpm install

# 3. Build the distributable
cd ../.. && pnpm build:gui
```

Or use the root scripts (each project must have its dependencies installed first):

```bash
pnpm build:base        # build base library
pnpm build:cli         # build CLI
pnpm build:gui         # build Linux GUI zip
pnpm build:gui:win32   # build Windows x64 GUI
pnpm build:gui:darwin  # build macOS universal GUI (must run on a Mac)
```

The GUI output is at `GUI/app/out/make/`.

### Build dependencies

- `zip` — required by all `build:gui:*` commands to create distributable archives

# Micrio image processing clients

This is an open source repository for enabling people to process ultra resolution images on their own computer, minimizing any upload and processing times to upload images to Micrio.

Learn more about Micrio at https://micr.io/

## Packages

- `base` The [`@micrio/tiler-base`](https://www.npmjs.com/package/@micrio/tiler-base) package — client-side tiler library.
- `CLI` The [`@micrio/cli`](https://www.npmjs.com/package/@micrio/cli) command-line tool to process and upload images to your Micrio account.
- `GUI/app` The graphical user interface: an Electron desktop app with a Svelte + Tailwind frontend (built by Electron Forge as the app's renderer).

## Building the CLI

```bash
cd CLI
pnpm install
pnpm build
```

## Building the GUI

```bash
cd GUI/app && pnpm install
cd ../.. && pnpm make:darwin   # or make:win32 / make:linux
```

Root scripts:

```bash
pnpm build:base   # build base library
pnpm build:cli    # build CLI
pnpm make:darwin  # build+package the macOS GUI (arm64; signed+notarized in CI)
pnpm make:win32   # build+package the Windows GUI (x64)
pnpm make:linux   # build+package the Linux GUI (x64)
```

The GUI output is at `GUI/app/out/make/`. Each `make:*` target must run on its own OS.

## Releasing the GUI

Signed macOS builds are produced by CI, not by hand. Push a `gui-v*` tag (e.g. `gui-v0.3.0`)
and the `.github/workflows/release.yml` workflow builds all three platforms and attaches them
to a draft GitHub Release. macOS is code-signed + notarized (Developer ID); Windows and Linux
are unsigned. See the workflow file for the required signing secrets.

### Build dependencies

- `zip` — required by the zip maker to create distributable archives

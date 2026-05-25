# Micrio Uploader GUI

## Prerequisites

- [pnpm](https://pnpm.io/) 10+
- Node.js 18+
- `zip` — required to create distributable archives

## Quick start

```bash
cd GUI/ui && pnpm install
cd ../app && pnpm install
cd ../.. && pnpm build:gui
```

This builds the Svelte UI, the Electron main process, and produces a distributable zip at `GUI/app/out/make/zip/linux/x64/`.

## Developing

```bash
# Terminal 1: UI dev server (hot-reload)
cd GUI/ui && pnpm dev

# Terminal 2: Electron app (connects to UI dev server)
cd GUI/app && pnpm start
```

## Packaging for other platforms

```bash
# Windows x64 (run from repo root)
cd GUI/ui && pnpm build && cd ../app && pnpm exec -- electron-forge make --arch x64 --platform win32

# macOS universal (must build on a Mac)
cd GUI/ui && pnpm build && cd ../app && pnpm exec -- electron-forge make --arch universal --platform darwin
```

`make` generates an installable package; `package` only bundles the compiled app.

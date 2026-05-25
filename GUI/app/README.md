# Micrio Uploader GUI

## Prerequisites

- [pnpm](https://pnpm.io/) 10+
- Node.js 18+
- `zip` — required to create distributable archives

## Building

From the repository root:

```bash
pnpm install
pnpm build:gui
```

This builds the Svelte UI, the Electron main process, and produces a distributable zip at `out/make/zip/linux/x64/`.

## Developing

```bash
# Terminal 1: UI dev server (hot-reload)
cd GUI/ui && pnpm dev

# Terminal 2: Electron app (connects to UI dev server)
cd GUI/app && pnpm start
```

## Packaging for other platforms

```bash
# Windows x64
pnpm run build:gui:win32

# macOS universal (must build on a Mac)
pnpm run build:gui:darwin
```

`make` generates an installable package; `package` only bundles the compiled app without creating a distributable.

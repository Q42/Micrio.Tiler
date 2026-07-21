# Micrio Uploader GUI

An Electron desktop app with a Svelte + Tailwind frontend. Electron Forge builds
the Svelte app in `src/renderer` as the app's renderer process (no separate UI build).

## Prerequisites

- [pnpm](https://pnpm.io/) 10+
- Node.js 18+
- `zip` — required to create distributable archives

## Quick start

```bash
pnpm install
cd ../.. && pnpm make:darwin   # or make:win32 / make:linux
```

Produces a distributable under `GUI/app/out/make/`.

## Developing

```bash
pnpm start   # Electron app with renderer hot-reload
```

## Packaging

```bash
# From the repo root, on the matching OS:
pnpm make:darwin   # macOS arm64 (.dmg + .zip)
pnpm make:win32    # Windows x64 (.zip)
pnpm make:linux    # Linux x64 (.zip)
```

`make` generates the distributable; `pnpm package` only bundles the compiled `.app`
without a maker.

## Code signing

macOS builds are code-signed + notarized in CI (see `.github/workflows/release.yml`).
Signing runs automatically when the `APPLE_API_KEY_ID` env var is present; local builds
without it produce an unsigned app. Windows and Linux builds are unsigned.

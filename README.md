# Omni

Omni is a desktop developer workspace supervisor that runs multiple isolated project sessions in one app.

It combines:
- an Electron shell,
- embedded code-server IDE sessions,
- per-workspace preview/browser tabs,
- per-workspace multi-terminal tabs,
- persisted workspace/session state,
- secure BYOK key storage for provider integrations.

## Features

- Multi-workspace management (create, start, stop, reopen)
- Isolated workspace sessions with dedicated partitions
- Embedded IDE per workspace (code-server)
- Multi-terminal tabs per workspace (create, rename, switch, close)
- Browser/preview tabs per workspace with persistence
- Workspace activity monitoring (focused/background/idle + terminal progress)
- Encrypted API key vault using Electron safe storage

## Tech Stack

- Node.js + npm workspaces
- TypeScript
- Electron
- code-server (bundled runtime)
- xterm.js for terminal surfaces

## Repository Layout

- `apps/desktop` — Electron desktop app
- `packages/shared` — shared contracts/types
- `packages/omni-bridge` — VS Code extension package (BYOK bridge)

## Prerequisites

- Node.js 20+
- npm 10+
- Windows/macOS/Linux supported by Electron + Node toolchain

## Getting Started

From repository root:

```bash
npm install
npm run build
```

Run the desktop app in development mode:

```bash
npm run dev
```

## Common Scripts

From repository root:

- `npm run dev` — build and launch desktop app
- `npm run build` — build all workspaces/packages
- `npm run typecheck` — run type checks across workspaces
- `npm run update:code-server` — force refresh bundled code-server runtime

Desktop-only (workspace selector):

- `npm run build -w @omni/desktop`
- `npm run dev -w @omni/desktop`
- `npm run package:win -w @omni/desktop`

## Build and Packaging

### Desktop build

```bash
npm run build -w @omni/desktop
```

### Windows installer

```bash
npm run package:win -w @omni/desktop
```

Installer output is written to `apps/desktop/out`.

## Environment Variables

- `OMNI_CODE_SERVER_BIN` (optional): custom path to a code-server executable.

If not set, Omni uses the bundled runtime under `apps/desktop/vendor/code-server`.

## Security Notes

- Provider keys are stored encrypted using Electron `safeStorage`.
- Keys are injected into workspace process environments at launch time.

## License

No license is currently declared. Add a license file before publishing publicly if you intend open-source distribution.

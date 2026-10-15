---
paths:
  - "src/web-client/**"
  - "src/web/http/staticClient.js"
---

# Web client (`src/web-client/`)

React + Vite + TypeScript, built to `src/web-client/dist/` — the one part of the repo that is
TypeScript. Structure, routing from the site root, styles, i18n and building blocks:
[docs/web-admin.md](../../docs/web-admin.md).

- **The menu needs the client built.** Everything outside `/api`, `/auth`, `/health` and the `/r/`
  report pages is served from `dist/` (`src/web/http/staticClient.js`). Run
  `cd src/web-client && npm install && npm run build` once per fresh worktree before starting the
  backend, or `npm run dev` inside `src/web-client/` (its own Vite dev server, proxying `/api` to the
  backend's `WEB_PORT` from `.env.dev`, see `src/web-client/vite.config.ts`) for live-reloading
  frontend work. A missing/stale `dist/` means the menu 404s outright — there is no server-rendered
  fallback anymore.
- **Own test suite: Vitest** (jsdom + Testing Library), `cd src/web-client && npm test`, tests as
  `*.test.ts(x)` next to the module. Behaviour is tested by rendering; only structural conventions
  stay as source scans in `test/web-client/conventions/` (root Jest). Details: docs/testing.md,
  „Web-Client“.
- **Lint:** own `src/web-client/eslint.config.js`, which adds `eslint-plugin-react` and `jsx-a11y`
  to the root rules.

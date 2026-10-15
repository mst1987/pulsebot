---
paths:
  - "test/**"
  - "jest.config.js"
  - "src/web-client/src/**/*.test.ts"
  - "src/web-client/src/**/*.test.tsx"
---

# Writing tests

Helpers, factories, mock convention and coverage thresholds in full:
[docs/testing.md](../../docs/testing.md) — check there before writing a helper of your own.

**Where a test goes:**
- `utils/`, `classes/`, `commands/`, `config/`, `stores/`, `services/` and `web/` are mirrored one
  to one: `src/utils/time/index.js` → `test/utils/time/index.test.js`.
- A route module `src/web/apiRoutes/<name>.js` is tested in `test/web/apiRoutes/<name>.test.js`
  (through the real router with `routerClient` from `test/helpers/http.js`);
  `test/web/http/apiRouter.test.js` keeps only dispatch, 404/405, error handling and the area gate.
- A suite too big for one file, or a topic of one module, is `<modul>.<thema>.test.js` next to it
  (`test/web/loot/lootCouncil.gear.test.js`).
- Every backend module is loaded by at least one test: `test/docs/testMirror.test.js` fails
  otherwise; its allowlist is for pure data tables (with a reason).
- The React client has its own suite: Vitest, `*.test.ts(x)` next to the module (docs/testing.md,
  „Web-Client“).

**How:**
- Config in `jest.config.js` (Node environment, coverage from `src/**/*.js`). `coverageThreshold`
  sits about a point under the measured coverage, so `npm run test:coverage` fails when it sinks;
  console output is shown only for failing tests.
- No real network: use the shared mocks in `test/helpers/` (`mockInteraction()`, module mocks for the
  `classes/*` API clients) and `jest.mock(...)`. `test/setup/noNetwork.js` (`setupFiles`) makes
  unmocked axios, `http(s).request/get` and `fetch` throw and fail the test, even when the code
  swallows the error (loopback stays open).
- A store a suite points somewhere else (`useFile`) gets its file from `test/helpers/tempStore.js`'s
  `tempStoreFile(name)` — its own scratch directory, removed at the end of the suite. Not
  `os.tmpdir()` plus `process.pid`: that left 96 stale files in `%TEMP%` before #315 (pids repeat,
  `forceExit` can skip an `afterAll`). A suite that wants no disk at all mocks `fs` with
  `test/helpers/memoryFs.js`.
- Prefer testing pure logic directly (formatters in `src/utils/format.js`, date math in
  `src/utils/time/index.js`, the logcheck analyzers in `src/utils/logcheck/`). For command files,
  assert on which helper (`botReply`/`botEditReply`) was called with which arguments.
- ESLint knows the Jest globals under `test/` (`eslint.config.mjs`, plus `eslint-plugin-jest`).

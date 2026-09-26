// A few client libs mirror a backend module (raid templates, attendance,
// channel names, ...), and their tests check both sides agree. The backend is
// CommonJS, so it is loaded with Node's own require, not through Vite:
//
//   const { listRaidTemplates } = requireBackend("web/raidTemplates");
import { createRequire } from "node:module";
import path from "node:path";

// src/web-client/src/test -> the repository's src/
const SRC = path.resolve(__dirname, "..", "..", "..");
const nodeRequire = createRequire(path.join(SRC, "index.js"));

/** A module under the repository's src/ (path without "src/", extension optional). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function requireBackend<T = any>(rel: string): T {
    return nodeRequire(path.join(SRC, rel)) as T;
}

/** The repository's src/ directory. */
export const BACKEND_SRC = SRC;

// The client's API layer is one file per area under src/web-client/src/api/
// (#437; before that a single api.ts of 4485 lines). index.ts re-exports every
// area, so a page keeps importing from "../api" — and every name the old file
// exported must still come out of it. The list of those names was taken from
// api.ts right before the split (fixtures/apiExports.json): a name that drops
// out of it is a breaking change for the pages, not a cleanup.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const API = path.join(CLIENT, "api");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

const EXPECTED = require("./fixtures/apiExports.json");
const index = read("api", "index.ts");

/** The names a module declares with `export` (types, functions, consts). */
function exportedNames(src) {
    return [...src.matchAll(/^export (?:type|async function|function|const|let) (\w+)/gm)].map((m) => m[1]);
}

/** Every name index.ts makes reachable: the `export *` modules plus its named re-exports. */
function reachable() {
    const names = new Map();
    for (const m of index.matchAll(/^export \* from "\.\/(\w+)";/gm)) {
        for (const name of exportedNames(read("api", `${m[1]}.ts`))) {
            if (names.has(name)) throw new Error(`${name} exported by both ${names.get(name)} and ${m[1]}`);
            names.set(name, m[1]);
        }
    }
    for (const m of index.matchAll(/^export \{ ([^}]+) \} from "([^"]+)";/gm)) {
        for (const name of m[1].split(",").map((s) => s.trim().replace(/^type /, ""))) names.set(name, m[2]);
    }
    return names;
}

describe("src/api/ replaces api.ts", () => {
    it("has no api.ts next to the folder any more", () => {
        expect(fs.existsSync(path.join(CLIENT, "api.ts"))).toBe(false);
        expect(fs.existsSync(path.join(API, "index.ts"))).toBe(true);
    });

    it("re-exports every name api.ts exported before the split", () => {
        const names = reachable();
        const missing = EXPECTED.filter((name) => !names.has(name));
        expect(missing).toEqual([]);
        expect(EXPECTED.length).toBeGreaterThan(500);
    });

    it("lists every area file in index.ts", () => {
        const files = fs.readdirSync(API).filter((f) => f.endsWith(".ts") && f !== "index.ts").map((f) => f.replace(/\.ts$/, ""));
        const listed = [...index.matchAll(/^export \* from "\.\/(\w+)";/gm)].map((m) => m[1]);
        expect(listed.sort()).toEqual(files.sort());
    });

    it("keeps fetch, the JSON parsing and the error shape in client.ts alone", () => {
        for (const file of fs.readdirSync(API)) {
            if (file === "client.ts") continue;
            const src = read("api", file);
            expect({ file, fetches: /\bfetch\(/.test(src) }).toEqual({ file, fetches: false });
            expect({ file, parses: /parseJson|errorFrom/.test(src) }).toEqual({ file, parses: false });
        }
        const client = read("api", "client.ts");
        expect(client).toContain("export type ApiError = { code: string; message: string };");
        expect(client).toMatch(/^export async function get</m);
        expect(client).toMatch(/^export async function send</m);
        expect(client).toMatch(/^export async function sendRaw</m);
        expect(client).toMatch(/^export async function pollJob\(/m);
    });

    it("moved the access helpers to lib/access.ts and keeps them reachable from the api for now", () => {
        const access = read("lib", "access.ts");
        expect(access).toMatch(/^export function canAccess\(/m);
        expect(access).toMatch(/^export function canAccessAny\(/m);
        expect(index).toContain("export { canAccess, canAccessAny } from \"../lib/access\";");
        for (const file of fs.readdirSync(API)) expect(read("api", file)).not.toMatch(/function canAccess/);
    });
});

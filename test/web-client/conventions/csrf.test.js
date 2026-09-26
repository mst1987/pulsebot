// The CSRF token lives in the client (api/csrf.ts, #437): GET /api/session
// stores it once, send() puts it on every mutating request. No page, dialog
// or api function takes it as a parameter or prop any more — the 361 places
// that used to hand it down are what this guards against coming back.
// The token store itself runs in src/web-client/src/api/csrf.test.ts (Vitest).
const fs = require("fs");
const path = require("path");
const { CLIENT, read, sourceFiles } = require("../clientSource");

// every .ts/.tsx of the app (the client's own tests left out)
const walk = (dir) => sourceFiles(path.relative(CLIENT, dir));

describe("client.ts uses it for every mutating request", () => {
    const client = read("api/client.ts");
    const session = read("api/session.ts");

    it("send() and sendRaw() take no token and build their headers from the stored one", () => {
        expect(client).toMatch(/^export async function send<T>\(method: string, path: string, jsonBody\?: unknown\): Promise<T> \{/m);
        expect(client).toMatch(/^export async function sendRaw<T>\(method: string, path: string, body: BodyInit, contentType: string\): Promise<T> \{/m);
        expect(client.match(/mutatingHeaders\(("application\/json"|contentType), getCsrfToken\(\)\)/g)).toHaveLength(2);
        expect(client).not.toContain("X-CSRF-Token");
    });

    it("stores the token the moment the session is loaded", () => {
        expect(session).toMatch(/const session = await get<Session>\("\/api\/session"\);\s*setCsrfToken\(session\.csrfToken\);\s*return session;/);
    });
});

describe("no csrfToken is handed around any more", () => {
    it("appears in no source outside api/csrf.ts and the Session type", () => {
        const allowed = new Set(["api/csrf.ts", "api/session.ts"]);
        const hits = [];
        for (const file of walk(CLIENT)) {
            const rel = path.relative(CLIENT, file).split(path.sep).join("/");
            if (allowed.has(rel)) continue;
            const src = fs.readFileSync(file, "utf8");
            if (/csrfToken/.test(src)) hits.push(rel);
        }
        expect(hits).toEqual([]);
    });

    it("is not a parameter of any api function", () => {
        for (const file of fs.readdirSync(path.join(CLIENT, "api"))) {
            const src = read(`api/${file}`);
            expect({ file, param: /\(\s*csrfToken\b/.test(src) }).toEqual({ file, param: false });
        }
    });

    it("the shell's outlet context carries the user only", () => {
        expect(read("components/Shell.tsx")).toContain("export type ShellContext = { user: SessionUser };");
    });
});

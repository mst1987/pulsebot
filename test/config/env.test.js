const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

// Load config/env.js against a given environment (only the listed keys set).
function loadEnv(vars) {
    const saved = process.env;
    process.env = { ...vars };
    try {
        let env;
        jest.isolateModules(() => {
            env = require("../../src/config/env");
        });
        return env;
    } finally {
        process.env = saved;
    }
}

describe("config/env", () => {
    describe("values", () => {
        it("falls back to the bootstrap values of config/defaults.js", () => {
            const env = loadEnv({});
            const defaults = require("../../src/config/defaults");
            expect(env.adminUserId).toBe(defaults.adminUserId);
            expect(env.guildId).toBe(defaults.guildId);
            expect(env.googleSheetName).toBe(defaults.googleSheetName);
            expect(env.googleSheetGid).toBe(defaults.googleSheetGid);
            expect(env.blizzardRegion).toBe(defaults.blizzardRegion);
            expect(env.blizzardRealmSlug).toBe(defaults.blizzardRealmSlug);
            expect(env.applyArmoryUrlTemplate).toBe(defaults.applyArmoryUrlTemplate);
            expect(env.webPort).toBe(defaults.webPort);
            expect(env.publicBaseUrl).toBe(`http://localhost:${defaults.webPort}`);
            expect(env.raidhelperServerId).toBe("");
            expect(env.discordClientSecret).toBe("");
            expect(env.adminRoleIds).toEqual([]);
            expect(env.devAutoLogin).toBe(false);
        });

        it("takes what the environment sets", () => {
            const env = loadEnv({
                ADMIN_USER_ID: "111",
                GUILD_ID: "222",
                WEB_PORT: "3024",
                GOOGLE_SHEET_GID: "7",
                CLIENT_SECRET: "legacy",
                LOGCHECK_ADMIN_IDS: " 333 , ,444",
                ADMIN_ROLE_IDS: "555,",
                DEV_AUTO_LOGIN: "1",
            });
            expect(env.adminUserId).toBe("111");
            expect(env.guildId).toBe("222");
            expect(env.webPort).toBe(3024);
            expect(env.publicBaseUrl).toBe("http://localhost:3024");
            expect(env.googleSheetGid).toBe(7);
            expect(env.discordClientSecret).toBe("legacy");
            expect(env.logcheckAdminIds).toEqual(["111", "333", "444"]);
            expect(env.adminRoleIds).toEqual(["555"]);
            expect(env.devAutoLogin).toBe(true);
        });

        it("never enables the dev auto-login in production", () => {
            expect(loadEnv({ DEV_AUTO_LOGIN: "1", NODE_ENV: "production" }).devAutoLogin).toBe(false);
        });

        it("prefers DISCORD_CLIENT_SECRET over the older CLIENT_SECRET", () => {
            expect(loadEnv({ DISCORD_CLIENT_SECRET: "new", CLIENT_SECRET: "old" }).discordClientSecret).toBe("new");
        });
    });

    describe("validateEnv", () => {
        const { validateEnv } = require("../../src/config/env");
        const complete = { DISCORDJS_BOT_TOKEN: "token", CLIENT_ID: "123" };

        it("says nothing when everything required is set", () => {
            const warn = jest.fn();
            expect(validateEnv({ ...complete, WEB_PORT: "3024", GOOGLE_SHEET_GID: "0" }, warn)).toEqual({ missing: [], invalid: [] });
            expect(warn).not.toHaveBeenCalled();
        });

        it("names every missing required variable and what goes without it", () => {
            const warn = jest.fn();
            const result = validateEnv({ CLIENT_ID: "  " }, warn);
            expect(result.missing).toEqual(["DISCORDJS_BOT_TOKEN", "CLIENT_ID"]);
            expect(warn).toHaveBeenCalledTimes(2);
            expect(warn.mock.calls[0][0]).toMatch(/DISCORDJS_BOT_TOKEN is not set: no Discord login/);
            expect(warn.mock.calls[1][0]).toMatch(/CLIENT_ID is not set/);
        });

        it("reports numbers that are none", () => {
            const warn = jest.fn();
            const result = validateEnv({ ...complete, WEB_PORT: "abc", GOOGLE_SHEET_GID: "1.5" }, warn);
            expect(result.invalid).toEqual(["WEB_PORT", "GOOGLE_SHEET_GID"]);
            expect(warn.mock.calls[0][0]).toMatch(/WEB_PORT="abc" is not a whole number between 1 and 65535/);
        });

        it("rejects a port outside the valid range", () => {
            expect(validateEnv({ ...complete, WEB_PORT: "70000" }, () => {}).invalid).toEqual(["WEB_PORT"]);
        });

        it("points out a dev auto-login that production ignores", () => {
            const warn = jest.fn();
            const result = validateEnv({ ...complete, DEV_AUTO_LOGIN: "1", NODE_ENV: "production" }, warn);
            expect(result.invalid).toEqual(["DEV_AUTO_LOGIN"]);
            expect(warn.mock.calls[0][0]).toMatch(/ignored because NODE_ENV=production/);
        });

        it("reads process.env and reports through console.warn by default", () => {
            const saved = process.env;
            const spy = jest.spyOn(console, "warn").mockImplementation(() => {});
            process.env = {};
            try {
                expect(validateEnv().missing).toEqual(["DISCORDJS_BOT_TOKEN", "CLIENT_ID"]);
                expect(spy).toHaveBeenCalledTimes(2);
            } finally {
                process.env = saved;
                spy.mockRestore();
            }
        });
    });
});

// Every variable the code reads has to be documented in .env.example — that
// file is the only list of them an operator sees (#418).
describe(".env.example", () => {
    function sourceFiles(dir) {
        const out = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "node_modules" || entry.name === "web-client") continue;
                out.push(...sourceFiles(full));
            } else if (entry.name.endsWith(".js")) {
                out.push(full);
            }
        }
        return out;
    }

    const readVars = new Map();
    for (const file of [...sourceFiles(path.join(ROOT, "src")), ...sourceFiles(path.join(ROOT, "scripts"))]) {
        const text = fs.readFileSync(file, "utf8");
        for (const m of text.matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])/g)) {
            const name = m[1] || m[2];
            if (!readVars.has(name)) readVars.set(name, path.relative(ROOT, file));
        }
    }
    const example = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
    // `NAME=` at the start of a line, or commented out as `# NAME=`, each with its
    // explanation after a `#` on the same line.
    const documented = new Map();
    for (const line of example.split(/\r?\n/)) {
        const m = /^#?\s*([A-Z][A-Z0-9_]*)=([^#]*)(#.*)?$/.exec(line);
        if (m) documented.set(m[1], (m[3] || "").replace(/^#\s*/, "").trim());
    }

    it("finds the variables the code reads", () => {
        expect(readVars.size).toBeGreaterThan(20);
        expect(readVars.has("DISCORDJS_BOT_TOKEN")).toBe(true);
    });

    it.each([...readVars.keys()].sort())("documents %s with a comment", (name) => {
        expect({ name, documented: documented.has(name) }).toEqual({ name, documented: true });
        expect(documented.get(name).length).toBeGreaterThan(0);
    });

    it("lists every variable env.js requires", () => {
        const { REQUIRED } = require("../../src/config/env");
        for (const { name } of REQUIRED) expect(documented.has(name)).toBe(true);
    });
});

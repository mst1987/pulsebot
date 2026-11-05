// Guard (#1072): the server-admin rank gives full rights on one server's data. Raider profiles, the
// character list and the templates hold every server, so a route handler that reads or writes them must say what
// the rank may do there: the route carries `sharedData: true` (apiAccess.js counts the roles alone),
// the handler limits the rank itself (`onlyByRank`, `mayLearnClasses`, ...), or the handler is named in
// ALLOWED below with the reason it shows nothing of another server.
//
// A text check like layering.test.js: it reads the handlers under src/web/apiRoutes and follows the
// helpers of the same file. It does NOT see a store reached through a service (signupService,
// charGear) or a module of its own; that remains for the review.
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "..", "src");
const ROUTES = path.join(SRC, "web", "apiRoutes");

// The stores' global calls, per the module they come from; a file may name the module anything.
const STORES = [
    {
        module: "raiderProfileStore",
        calls: ["listProfiles", "saveProfile", "addCharacter", "editCharacter", "removeCharacter", "setCharacterArmory", "verifyCharacter"],
    },
    { module: "characterStore", calls: ["listCharacters", "saveCharacter", "characterMap"] },
    { module: "characterInfo", calls: ["resolveMissing", "rememberFromLoot"] },
    // the sheet, call-out and recruitment templates: one list for every server until #1097
    { module: "settingsStore", calls: ["listRaidsheets", "getRaidsheet", "listNotify", "getNotify", "listRecruitment", "getRecruitment"] },
];

/** What in a handler (or a helper it calls) counts as limiting the rank. */
const RANK_CHECK = /\b(onlyByRank|mayLearnClasses|tokenMayLearnClasses|rolesOnly)\b/;

// every handler of setup.js reaches setupView, whose only global read is this number
const AVOID_COUNT = "setupView only counts the avoid pairs among the event's own signups";

/** `<file>:<handler>` -> why it needs no check. */
const ALLOWED = {
    "events/setup.js:getSetup": AVOID_COUNT,
    "events/setup.js:putSetup": AVOID_COUNT,
    "events/setup.js:postPropose": AVOID_COUNT,
    "events/setup.js:postApprove": AVOID_COUNT,
    "events/setup.js:postPublish": AVOID_COUNT,
    "events/setup.js:postPingText": AVOID_COUNT,
    "events/setup.js:postConfirm": AVOID_COUNT,
    "events/setup.js:postExtraRole": AVOID_COUNT,
    "events/setup.js:getSignupEdit": AVOID_COUNT,
    "events/setup.js:putSignupEdit": AVOID_COUNT,
    "events/setup.js:postMoveRaid": AVOID_COUNT,
    "loot/lootCouncil.js:getExport": "characterMap gives only class and spec of the asked name (the gear behind it: see the follow-up in #1072)",
    "roster/profile.js:putProfile": "writes the caller's own profile (user.id); the list only drops unknown wish ids",
    "roster/profile.js:postProfileCharacter": "writes the caller's own profile (user.id)",
};

function jsFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return jsFiles(full);
        return entry.name.endsWith(".js") ? [full] : [];
    });
}

/** The file's top-level declarations: name -> source text. */
function declarations(text) {
    const out = new Map();
    const parts = text.split(/^(?=(?:async function|function|const|let) )/m);
    for (const part of parts) {
        const m = part.match(/^(?:async function|function|const|let) (\w+)/);
        if (m) out.set(m[1], part);
    }
    return out;
}

/** The names under which a file can call the global stores: `alias.call(` and destructured `call(`. */
function globalCalls(text) {
    const found = [];
    for (const { module, calls } of STORES) {
        const required = new RegExp(`const (\\w+|\\{[^}]*\\}) = require\\(["'][^"']*/${module}["']\\)`, "g");
        for (const m of text.matchAll(required)) {
            if (m[1].startsWith("{")) {
                for (const piece of m[1].slice(1, -1).split(",")) {
                    const [source, local] = piece.split(":").map((s) => s.trim());
                    if (calls.includes(source)) found.push(new RegExp(`(?<![\\w.])${local || source}\\(`));
                }
            } else {
                for (const call of calls) found.push(new RegExp(`\\b${m[1]}\\.${call}\\(`));
            }
        }
    }
    return found;
}

/** The handler plus the helpers of the file it reaches, as one text. */
function reach(name, decls) {
    const seen = new Set([name]);
    const queue = [name];
    while (queue.length) {
        const text = decls.get(queue.pop()) || "";
        for (const m of text.matchAll(/\b[A-Za-z_]\w*\b/g)) {
            if (decls.has(m[0]) && !seen.has(m[0])) {
                seen.add(m[0]);
                queue.push(m[0]);
            }
        }
    }
    return [...seen].map((n) => decls.get(n) || "").join("\n");
}

/** Every handler of a route not marked `sharedData`, in the file that holds it, that touches a global store. */
function handlersOnGlobalStores() {
    const out = [];
    for (const file of jsFiles(ROUTES)) {
        const text = fs.readFileSync(file, "utf8");
        const calls = globalCalls(text);
        if (!calls.length) continue;
        const decls = declarations(text);
        // the route table is not code a handler reaches, and neither is the module's own export
        decls.delete("routes");
        const rel = path.relative(ROUTES, file).split(path.sep).join("/");
        for (const m of text.matchAll(/\{[^{}\n]*\bhandler: (\w+)[^\n]*\}/g)) {
            const source = reach(m[1], decls);
            if (!calls.some((call) => call.test(source))) continue;
            out.push({ id: `${rel}:${m[1]}`, shared: /sharedData: true/.test(m[0]), ranked: RANK_CHECK.test(source) });
        }
    }
    return out;
}

describe("the server-admin rank on global stores (#1072)", () => {
    const handlers = handlersOnGlobalStores();
    const unanswered = (list) => list.filter((h) => !h.shared && !h.ranked).map((h) => h.id);

    it("finds what it looks for: a limited handler, a marked route", () => {
        expect(handlers.find((h) => h.id === "loot/history.js:resolveCharacters")).toMatchObject({ ranked: true });
        expect(handlers.find((h) => h.id === "roster/profile.js:putProfile")).toMatchObject({ shared: false, ranked: false });
        expect(handlers.some((h) => h.shared)).toBe(true);
    });

    it("every handler on a global store is marked, limits the rank or is named with a reason", () => {
        const open = unanswered(handlers).filter((id) => !ALLOWED[id]);
        expect(open).toEqual([]);
    });

    it("names no handler that does not need it any more", () => {
        const needed = new Set(unanswered(handlers));
        expect(Object.keys(ALLOWED).filter((id) => !needed.has(id))).toEqual([]);
    });

    it("sees the templates: what mixes them with a server's own data limits the rank, what manages them is marked", () => {
        for (const id of ["system/settings.js:getSettings", "system/recruitment.js:getRecruitmentData", "events/raidDetail.js:postNotify", "events/raidDetail.js:postFill"]) {
            expect(handlers.find((h) => h.id === id)).toMatchObject({ shared: false, ranked: true });
        }
        for (const id of ["events/notifyTemplates.js:getNotifyTemplates", "system/recruitment.js:postRecruitmentTemplate"]) {
            expect(handlers.find((h) => h.id === id)).toMatchObject({ shared: true });
        }
    });

    // src/web/events holds no route, so the scan above does not reach the two lists of the raid detail.
    it("the raid detail view reads the template lists only behind templatesClosed", () => {
        const view = fs.readFileSync(path.join(SRC, "web", "events", "raidDetailView.js"), "utf8");
        const reads = [...view.matchAll(/^.*\b(?:listRaidsheets|listNotify)\(\).*$/gm)].map((m) => m[0]);
        expect(reads).toHaveLength(2);
        for (const line of reads) expect(line).toMatch(/templatesClosed \? \[\] :/);
    });
});

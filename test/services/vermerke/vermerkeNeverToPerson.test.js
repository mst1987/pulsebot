// Vermerke never reach the person they are about (docs/vermerke.md, #979).
//
// Statically: none of the pages a raider reads about himself - the profile,
// /api/signups, the dashboard "Für dich", the public event page /e/<id>, the
// raid plan behind /p/<token>, and "Ansicht als Raider" - loads the store or the
// short form, not even through another module (the whole require closure).
// Dynamically, with a marker text: a raider (also the noted person himself) and
// an admin in "Ansicht als Raider" get 403 on every Vermerke route and never the
// marker; the short form never carries the text.
const fs = require("fs");
const path = require("path");
const { status, body, routerClient } = require("../../helpers/http");
const { tempStoreFile } = require("../../helpers/tempStore");

let mockUser = null;
jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => mockUser),
    getRealUser: jest.fn(() => mockUser),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
    getActiveGuild: jest.fn(() => "A"),
}));
jest.mock("../../../src/web/http/activeGuild", () => ({
    activeGuildFor: jest.fn(() => "A"),
    pickActiveGuild: jest.fn(async () => "A"),
}));
jest.mock("../../../src/services/roster/categoryOrga", () => ({
    ...jest.requireActual("../../../src/services/roster/categoryOrga"),
    isAnyCategoryManager: jest.fn(async () => false),
}));

const notes = require("../../../src/stores/roster/userNotesStore");
const { shortFor } = require("../../../src/services/vermerke/vermerkeShort");
const { emptyAccess } = require("../../../src/config/permissions");
const { effectiveUser } = require("../../../src/web/http/viewAs");
const route = require("../../../src/web/apiRoutes/roster/vermerke");
const { get, post } = routerClient(route);

const SRC = path.join(__dirname, "..", "..", "..", "src");
const MARKER = "VERMERK-MARKER-7f3a";
const U = "111111111111111111";
const RAIDER_ROLE = "444444444444444444";

/** Every src module `entry` loads, through relative requires, itself included. */
function requireClosure(entry) {
    const seen = new Set();
    const stack = [path.join(SRC, entry)];
    while (stack.length) {
        const file = stack.pop();
        if (seen.has(file)) continue;
        seen.add(file);
        const text = fs.readFileSync(file, "utf8");
        for (const m of text.matchAll(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
            let target;
            try {
                target = require.resolve(path.resolve(path.dirname(file), m[1]));
            } catch {
                continue; // a JSON or generated file that is not there in a checkout
            }
            if (target.startsWith(SRC) && target.endsWith(".js")) stack.push(target);
        }
    }
    return [...seen].map((f) => path.relative(SRC, f).split(path.sep).join("/"));
}

const PERSON_PAGES = [
    "web/apiRoutes/roster/profile.js",
    "web/apiRoutes/events/signups.js",
    "web/apiRoutes/system/dashboard.js",
    "web/dashboard/dashboardPersonal.js",
    "web/pages/eventPublicPage.js",
    "web/apiRoutes/raidplan/raidplan.js",
    "web/http/viewAs.js",
];
// the read side of the hints (#982) and the person search of the dialog (#980) too: the signup pages
// only write events (signalRecorder.js); the orga's hint at signup (#983) only queues there
// (orgaSignupQueue.js), its read side and post (orgaSignupNotice.js) are the bot's job
const NOTE_MODULES = [
    "stores/roster/userNotesStore.js", "services/vermerke/vermerkeShort.js", "services/vermerke/userSignals.js", "services/vermerke/vermerkePeople.js",
    "web/apiRoutes/roster/vermerke.js", "services/vermerke/orgaSignupNotice.js",
];

describe("Vermerke never reach the person", () => {
    it.each(PERSON_PAGES)("%s loads neither the store nor the short form", (entry) => {
        expect(fs.existsSync(path.join(SRC, entry))).toBe(true);
        const closure = requireClosure(entry);
        expect(closure.length).toBeGreaterThan(0);
        expect(closure.filter((rel) => NOTE_MODULES.includes(rel))).toEqual([]);
    });

    // #983: the signup path queues first signups, so the queue is in the raiders' closure -
    // and the queue itself reaches no Vermerk
    it("the signup queue is on the raiders' path and reads no Vermerk", () => {
        expect(requireClosure("web/apiRoutes/events/signups.js")).toContain("services/vermerke/orgaSignupQueue.js");
        const queueClosure = requireClosure("services/vermerke/orgaSignupQueue.js");
        expect(queueClosure.filter((rel) => NOTE_MODULES.includes(rel))).toEqual([]);
    });

    describe("with a marker text in the store", () => {
        beforeEach(() => {
            const file = tempStoreFile("user-notes.json");
            if (fs.existsSync(file)) fs.unlinkSync(file);
            notes.useFile(file);
            notes.addEntry("A", U, { level: "shadowban", reason: "behavior", text: MARKER, shared: true }, { by: "1", byName: MARKER, name: "Zed" });
        });
        afterAll(() => notes.useFile(null));

        const raider = { id: U, name: "Zed", isAdmin: false, access: { ...emptyAccess(), signup: { read: true, write: true }, profile: { read: true, write: true } } };
        const config = { baseAccess: { signup: "write", profile: "write" }, rolePermissions: {}, adminRoleIds: [], orgaRoleIds: [] };
        const viewing = effectiveUser({ id: "1", name: "Admin", isAdmin: true, access: emptyAccess(), viewAs: { roleIds: [RAIDER_ROLE], at: Date.now() } }, config);
        const calls = () => [
            get("/api/vermerke"),
            get("/api/vermerke/person", { userId: U }),
            get("/api/vermerke/short", { userIds: U }),
            get("/api/vermerke/people", { q: "Zed" }),
            get("/api/vermerke/raids", { userId: U }),
            post("/api/vermerke", { userId: U, level: "hint", reason: "other", text: "x" }),
            post("/api/vermerke/update", { userId: U, id: "n_x", text: "x" }),
            post("/api/vermerke/archive", { userId: U, id: "n_x" }),
            post("/api/vermerke/hide", { id: "n_x" }),
            post("/api/vermerke/delete", { userId: U, id: "n_x" }),
            get("/api/vermerke/signals"),
            post("/api/vermerke/signals/ignore", { userId: U, kind: "late_signoff" }),
            get("/api/vermerke/signals/settings"),
            post("/api/vermerke/signals/settings", { thresholds: { noShow: 1 } }),
        ];

        it("'Ansicht als Raider' is no admin", () => {
            expect(viewing.isAdmin).toBe(false);
            expect(viewing.viewAs).toBeTruthy();
        });

        it.each([["the noted raider", raider], ["an admin in 'Ansicht als Raider'", viewing]])("%s gets 403 everywhere, never the marker", async (_label, user) => {
            mockUser = user;
            for (const res of await Promise.all(calls())) {
                expect(status(res)).toBe(403);
                expect(JSON.stringify(body(res))).not.toContain(MARKER);
            }
        });

        it("the short form carries no text and no author", () => {
            const short = shortFor("A", [U]);
            expect(short[U].level).toBe("shadowban");
            expect(JSON.stringify(short)).not.toContain(MARKER);
            expect(JSON.stringify(shortFor("B", [U]))).not.toContain(MARKER);
        });
    });
});

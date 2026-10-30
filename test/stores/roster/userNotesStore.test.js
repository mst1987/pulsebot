// The Vermerke store (docs/vermerke.md, #979): notes per server and Discord
// account, normalised, limited, with expiry and history; a shared entry is read
// on every server and changed on its server of origin alone - and the store is
// read by the Vermerke routes and the short form only, never logged.
const fs = require("fs");
const path = require("path");
const { tempStoreFile } = require("../../helpers/tempStore");
const notes = require("../../../src/stores/roster/userNotesStore");

const U = "111111111111111111";
const V = "222222222222222222";
const by = { by: "9", byName: "Orga", now: 1000 };
const base = { level: "warning", reason: "no_show", text: "kam nicht" };

let file;
beforeEach(() => {
    file = tempStoreFile("user-notes.json");
    if (fs.existsSync(file)) fs.unlinkSync(file);
    notes.useFile(file);
});
afterAll(() => notes.useFile(null));

const code = (fn) => {
    try {
        fn();
    } catch (err) {
        return `${err.status} ${err.code}`;
    }
    return "no error";
};

describe("stores/roster/userNotesStore", () => {
    it("adds an entry with its fields, author and a first history line", () => {
        const e = notes.addEntry("A", U, { ...base, eventIds: ["e1", "e1", " e2 "], shared: true }, { ...by, name: "Zed" });
        expect(e).toMatchObject({
            level: "warning", reason: "no_show", text: "kam nicht", eventIds: ["e1", "e2"], expiresAt: null,
            shared: true, by: "9", byName: "Orga", at: 1000,
        });
        expect(e.id).toMatch(/^n_/);
        expect(e.history).toEqual([{ by: "9", byName: "Orga", at: 1000, action: "create", changes: [] }]);
        expect(notes.personFor("A", U).name).toBe("Zed");
        expect(JSON.parse(fs.readFileSync(file, "utf8")).guilds.A[U].entries).toHaveLength(1);
    });

    it("refuses what is no entry: no account, unknown level or reason, long text, bad expiry", () => {
        expect(code(() => notes.addEntry("A", "", base, by))).toBe("400 bad_user");
        expect(code(() => notes.addEntry("A", U, { ...base, level: "ban" }, by))).toBe("400 bad_level");
        expect(code(() => notes.addEntry("A", U, { ...base, reason: "x" }, by))).toBe("400 bad_reason");
        expect(code(() => notes.addEntry("A", U, { ...base, text: "x".repeat(notes.MAX_TEXT + 1) }, by))).toBe("400 text_too_long");
        expect(code(() => notes.addEntry("A", U, { ...base, expiresAt: "morgen" }, by))).toBe("400 bad_expiry");
        expect(code(() => notes.addEntry("A", U, { ...base, text: "x".repeat(notes.MAX_TEXT) }, by))).toBe("no error");
    });

    // #982: the reason for the hint "left the server" - a Vermerk with it hides that hint
    it("takes left_server as a reason", () => {
        expect(notes.REASONS).toContain("left_server");
        expect(notes.addEntry("A", U, { ...base, reason: "left_server" }, by).reason).toBe("left_server");
    });

    it("keeps at most MAX_ENTRIES entries per person and server", () => {
        for (let i = 0; i < notes.MAX_ENTRIES; i += 1) notes.addEntry("A", U, base, by);
        expect(code(() => notes.addEntry("A", U, base, by))).toBe("400 too_many");
        expect(code(() => notes.addEntry("B", U, base, by))).toBe("no error");
    });

    it("normalises what it reads: drops broken entries, cuts the text, unknown reason = other", () => {
        fs.writeFileSync(file, JSON.stringify({
            guilds: { A: { [U]: { name: "Zed", entries: [
                { id: "n_1", level: "hint", reason: "??", text: "y".repeat(2000), expiresAt: "2026-01-01T00:00:00Z", eventIds: "x" },
                { id: "", level: "hint" },
                { id: "n_2", level: "ban" },
                "junk",
            ] } } },
            hidden: { B: { n_1: { by: "5", at: 7 } } },
        }));
        const [e] = notes.personFor("A", U).entries;
        expect(e).toMatchObject({ id: "n_1", reason: "other", eventIds: [], shared: false, history: [] });
        expect(e.text).toHaveLength(notes.MAX_TEXT);
        expect(e.expiresAt).toBe(Date.parse("2026-01-01T00:00:00Z"));
        expect(notes.personFor("A", U).entries).toHaveLength(1);
    });

    it("counts an entry until it expires; never (null) counts for good; archived does not count", () => {
        const soon = notes.addEntry("A", U, { ...base, level: "shadowban", expiresAt: 5000 }, by);
        notes.addEntry("A", U, { ...base, level: "hint" }, by);
        expect(notes.activeLevelFor("A", U, { now: 4999 })).toBe("shadowban");
        expect(notes.activeLevelFor("A", U, { now: 5000 })).toBe("hint");
        expect(notes.isActive(soon, 6000)).toBe(false);
        // expired and archived entries stay in the archive
        expect(notes.personFor("A", U).entries).toHaveLength(2);
        const hint = notes.personFor("A", U).entries.find((e) => e.level === "hint");
        notes.archiveEntry("A", U, hint.id, by);
        expect(notes.activeLevelFor("A", U, { now: 6000 })).toBe(null);
        expect(notes.personFor("A", U).entries).toHaveLength(2);
        expect(notes.activeLevelFor("A", V)).toBe(null);
    });

    it("writes every change into the history, with the changed fields only", () => {
        const e = notes.addEntry("A", U, base, by);
        notes.updateEntry("A", U, e.id, { level: "warning", text: "doch abgemeldet" }, { by: "8", byName: "Lead", now: 2000 });
        notes.updateEntry("A", U, e.id, { text: "doch abgemeldet" }, { by: "8", now: 2500 });
        notes.archiveEntry("A", U, e.id, { by: "8", byName: "Lead", now: 3000 });
        expect(code(() => notes.updateEntry("A", U, e.id, { level: "hint" }, by))).toBe("409 archived");
        notes.archiveEntry("A", U, e.id, { archived: false, by: "8", now: 4000 });
        const stored = notes.personFor("A", U).entries[0];
        expect(stored.history.map((h) => [h.action, h.changes, h.at])).toEqual([
            ["create", [], 1000], ["update", ["text"], 2000], ["archive", [], 3000], ["restore", [], 4000],
        ]);
        expect(stored.text).toBe("doch abgemeldet");
        expect(stored.archived).toBeUndefined();
    });

    it("keeps the servers apart: B does not see what A did not share", () => {
        notes.addEntry("A", U, { ...base, text: "nur A" }, by);
        expect(notes.listFor("B")).toEqual({});
        expect(notes.personFor("B", U).entries).toEqual([]);
        expect(notes.activeLevelFor("B", U)).toBe(null);
    });

    it("shows a shared entry on another server, which reads it but cannot change it", () => {
        const e = notes.addEntry("A", U, { ...base, shared: true }, { ...by, name: "Zed" });
        const seen = notes.personFor("B", U);
        expect(seen.name).toBe("Zed");
        expect(seen.entries).toEqual([expect.objectContaining({ id: e.id, own: false, originGuildId: "A", hidden: false })]);
        expect(notes.activeLevelFor("B", U)).toBe("warning");
        expect(code(() => notes.updateEntry("B", U, e.id, { level: "hint" }, by))).toBe("404 not_found");
        expect(code(() => notes.archiveEntry("B", U, e.id, by))).toBe("404 not_found");
        expect(code(() => notes.removeEntry("B", U, e.id))).toBe("404 not_found");
        expect(notes.personFor("A", U).entries[0]).toMatchObject({ own: true, level: "warning" });
    });

    it("lets another server hide a shared entry for itself without deleting it", () => {
        const e = notes.addEntry("A", U, { ...base, shared: true }, by);
        notes.hideShared("B", e.id, { by: "5", now: 9 });
        expect(notes.personFor("B", U).entries[0].hidden).toBe(true);
        expect(notes.activeLevelFor("B", U)).toBe(null);
        expect(notes.activeLevelFor("A", U)).toBe("warning");
        notes.hideShared("B", e.id, { hidden: false });
        expect(notes.activeLevelFor("B", U)).toBe("warning");
        // the own server, an entry not shared or an unknown one: nothing to hide
        const own = notes.addEntry("B", U, base, by);
        expect(code(() => notes.hideShared("A", e.id))).toBe("404 not_found");
        expect(code(() => notes.hideShared("A", own.id))).toBe("404 not_found");
        expect(code(() => notes.hideShared("B", "n_nope"))).toBe("404 not_found");
    });

    it("removes an entry for good, the person when it was the last, and its hide marks", () => {
        const e = notes.addEntry("A", U, { ...base, shared: true }, by);
        notes.hideShared("B", e.id);
        expect(notes.removeEntry("A", U, e.id)).toBe(true);
        const doc = JSON.parse(fs.readFileSync(file, "utf8"));
        expect(doc.guilds.A[U]).toBeUndefined();
        expect(doc.hidden.B[e.id]).toBeUndefined();
        expect(code(() => notes.removeEntry("A", U, e.id))).toBe("404 not_found");
    });

    describe("who reads it", () => {
        const SRC = path.join(__dirname, "..", "..", "..", "src");
        function modulesMatching(re) {
            const out = [];
            const walk = (dir) => {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        if (entry.name !== "web-client" && entry.name !== "node_modules") walk(full);
                    } else if (entry.name.endsWith(".js") && re.test(fs.readFileSync(full, "utf8"))) {
                        out.push(path.relative(SRC, full).split(path.sep).join("/"));
                    }
                }
            };
            walk(SRC);
            return out.sort();
        }

        // everything else goes through the short form (services/vermerke/vermerkeShort.js): no text out
        it("is read by the Vermerke routes, the short form and the hints alone", () => {
            expect(modulesMatching(/require\(\s*["'][^"']*userNotesStore["']\s*\)/))
                .toEqual(["services/vermerke/userSignals.js", "services/vermerke/vermerkeShort.js", "web/apiRoutes/roster/vermerke.js"]);
        });

        it("writes nothing of a note into a log", () => {
            const own = ["stores/roster/userNotesStore.js", "services/vermerke/vermerkeShort.js", "services/vermerke/userSignals.js", "web/apiRoutes/roster/vermerke.js"];
            const logging = modulesMatching(/\b(console\.\w+|logger\.\w+)\s*\(|require\(\s*["'][^"']*\/logger["']\s*\)/)
                .filter((rel) => own.includes(rel));
            expect(logging).toEqual([]);
        });
    });
});

// In-memory fs so the store never touches the disk.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const rosterStore = require("../../src/stores/rosterStore");

const {
    listRosters, getRoster, rosterForCategory, createRoster, updateRoster, deleteRoster,
    upsertMember, removeMember, appendHistory, setFirstChars, migrateCategories,
    normalizeRoster, normalizeFile, RosterError, LIMITS, ROSTERS_FILE,
} = rosterStore;

const NOW = "2026-10-09T18:00:00.000Z";
const stored = () => JSON.parse(fs.__store.get(ROSTERS_FILE));

beforeEach(() => {
    fs.__store.clear();
});

describe("stores/rosterStore normalizeRoster", () => {
    it("fills every field with its default and drops unknown ones", () => {
        const r = normalizeRoster({ id: "r1", name: "Donnerstag", junk: 1 });
        expect(r).toEqual({
            id: "r1", guildId: "", name: "Donnerstag", categoryId: null, versionId: "tbc",
            roleIds: [], trialRoleId: null, managers: { roleIds: [], userIds: [] },
            slots: { total: 0, tank: 0, healer: 0, bench: 0 },
            allowMultipleChars: false, signupOnly: false, source: { kind: "manual" },
            members: {}, history: [], createdAt: "", createdBy: "",
        });
    });

    it("returns null without an id or for something that is no object", () => {
        expect(normalizeRoster({ name: "x" })).toBeNull();
        expect(normalizeRoster(null, "r1")).toBeNull();
        expect(normalizeRoster([], "r1")).toBeNull();
    });

    it("cuts name and note, dedupes ids, caps managers and members", () => {
        const many = Array.from({ length: 30 }, (_, i) => `${100 + i}`);
        const members = {};
        for (let i = 0; i < LIMITS.members + 5; i += 1) members[`u${i}`] = { status: "core" };
        members.u0.note = "n".repeat(600);
        const r = normalizeRoster({
            id: "r1", name: "x".repeat(50),
            roleIds: ["1", "1", " 2 ", "", null],
            managers: { roleIds: many, userIds: many, extra: true },
            members,
        });
        expect(r.name).toHaveLength(LIMITS.name);
        expect(r.roleIds).toEqual(["1", "2"]);
        expect(r.managers.roleIds).toHaveLength(LIMITS.managers);
        expect(r.managers.userIds).toHaveLength(LIMITS.managers);
        expect(Object.keys(r.managers)).toEqual(["roleIds", "userIds"]);
        expect(Object.keys(r.members)).toHaveLength(LIMITS.members);
        expect(r.members.u0.note).toHaveLength(LIMITS.note);
    });

    it("keeps one character without allowMultipleChars, several with it", () => {
        const member = { chars: ["Keslight", "keslight", "Devi-Thunderstrike", "forever~Pala"] };
        expect(normalizeRoster({ id: "r", members: { u: member } }).members.u.chars).toEqual(["keslight"]);
        expect(normalizeRoster({ id: "r", allowMultipleChars: true, members: { u: member } }).members.u.chars)
            .toEqual(["keslight", "devi", "forever~pala"]);
    });

    it("normalises a member: status, dates, names only for its chars", () => {
        const r = normalizeRoster({ id: "r", members: { u: {
            status: "boss", since: 0, trialUntil: "nope", chars: ["Kes"], charNames: { kes: "Kes", other: "X" }, by: "1".repeat(40),
        } } });
        expect(r.members.u).toEqual({
            status: "core", since: "1970-01-01T00:00:00.000Z", by: "", chars: ["kes"], charNames: { kes: "Kes" }, note: "", trialUntil: null,
        });
        const t = normalizeRoster({ id: "r", members: { u: { status: "trial", trialUntil: NOW } } });
        expect(t.members.u).toMatchObject({ status: "trial", trialUntil: NOW });
    });

    it("clamps slots, keeps a known version and the kader id only for a kader source", () => {
        const r = normalizeRoster({
            id: "r", versionId: "forever", slots: { total: "25", tank: -1, healer: 5.7, bench: 9999 },
            source: { kind: "kader", kaderId: "k1" }, allowMultipleChars: "yes", signupOnly: true, trialRoleId: "55",
        });
        expect(r.versionId).toBe("forever");
        expect(r.slots).toEqual({ total: 25, tank: 0, healer: 5, bench: LIMITS.slot });
        expect(r.source).toEqual({ kind: "kader", kaderId: "k1" });
        expect(r.allowMultipleChars).toBe(false);
        expect(r.signupOnly).toBe(true);
        expect(r.trialRoleId).toBe("55");
        expect(normalizeRoster({ id: "r", source: { kind: "manual", kaderId: "k1" } }).source).toEqual({ kind: "manual" });
        expect(normalizeRoster({ id: "r", versionId: "wotlk" }).versionId).toBe("tbc");
    });

    it("keeps the newest history entries only and drops invalid ones", () => {
        const history = Array.from({ length: LIMITS.history + 10 }, (_, i) => ({ at: i * 1000, what: `e${i}` }));
        history.push({ at: NOW }, "junk");
        const r = normalizeRoster({ id: "r", history });
        expect(r.history).toHaveLength(LIMITS.history);
        expect(r.history[0].what).toBe("e10");
        expect(r.history[r.history.length - 1].what).toBe(`e${LIMITS.history + 9}`);
    });
});

describe("stores/rosterStore normalizeFile", () => {
    it("tolerates garbage and keeps one roster per category", () => {
        expect(normalizeFile(null)).toEqual({ rosters: {}, migratedCategories: [] });
        const file = normalizeFile({
            rosters: { a: { categoryId: "c1", name: "A" }, b: { categoryId: "c1", name: "B" }, c: "x" },
            migratedCategories: ["c1", "c1", ""],
        });
        expect(Object.keys(file.rosters)).toEqual(["a"]);
        expect(file.migratedCategories).toEqual(["c1"]);
    });

    it("an unreadable file reads as empty", () => {
        fs.__store.set(ROSTERS_FILE, "{not json");
        expect(listRosters()).toEqual([]);
    });
});

describe("stores/rosterStore create / read / update / delete", () => {
    it("creates a roster with a slug id, history and creator", () => {
        const r = createRoster({ guildId: "g1", name: "Donnerstag Raid", categoryId: "c1", roleIds: ["10"] }, { actor: "u9", now: NOW });
        expect(r.id).toMatch(/^donnerstag-raid-[0-9a-f]{6}$/);
        expect(r).toMatchObject({ guildId: "g1", name: "Donnerstag Raid", categoryId: "c1", roleIds: ["10"], createdAt: NOW, createdBy: "u9" });
        expect(r.history).toEqual([{ at: NOW, by: "u9", userId: "", what: "created", detail: "Donnerstag Raid" }]);
        expect(getRoster(r.id)).toEqual(r);
        expect(rosterForCategory("c1")).toEqual(r);
        expect(stored().rosters[r.id].name).toBe("Donnerstag Raid");
    });

    it("names a roster after its category when no name is given and gives unique ids", () => {
        const a = createRoster({ categoryId: "c1" });
        const b = createRoster({ name: "Ohne Kategorie" });
        expect(a.name).toBe("c1");
        expect(b.categoryId).toBeNull();
        expect(a.id).not.toBe(b.id);
    });

    it("refuses a second roster for a category and a roster without name and category", () => {
        createRoster({ name: "A", categoryId: "c1" });
        expect(() => createRoster({ name: "B", categoryId: "c1" })).toThrow(RosterError);
        try {
            createRoster({ name: "B", categoryId: "c1" });
        } catch (e) {
            expect(e.code).toBe("category_taken");
        }
        expect(() => createRoster({})).toThrow(expect.objectContaining({ code: "invalid_name" }));
    });

    it("lists rosters per server by name", () => {
        createRoster({ guildId: "g1", name: "Zeta" });
        createRoster({ guildId: "g1", name: "Alpha" });
        createRoster({ guildId: "g2", name: "Beta" });
        expect(listRosters("g1").map((r) => r.name)).toEqual(["Alpha", "Zeta"]);
        expect(listRosters().map((r) => r.name)).toEqual(["Alpha", "Beta", "Zeta"]);
        expect(rosterForCategory("")).toBeNull();
        expect(getRoster("nope")).toBeNull();
    });

    it("updates settings, merges managers and slots, logs what changed and keeps fixed fields", () => {
        const r = createRoster({ name: "A", categoryId: "c1", slots: { total: 25 } }, { now: NOW });
        const next = updateRoster(r.id, {
            name: "A2", managers: { userIds: ["7"] }, slots: { tank: 3 }, allowMultipleChars: true,
            id: "hack", createdBy: "hack", members: { x: {} },
        }, { actor: "u1", now: NOW });
        expect(next).toMatchObject({ id: r.id, name: "A2", managers: { roleIds: [], userIds: ["7"] }, slots: { total: 25, tank: 3, healer: 0, bench: 0 }, allowMultipleChars: true });
        expect(next.members).toEqual({});
        expect(next.createdBy).toBe("");
        expect(next.history[next.history.length - 1]).toEqual({ at: NOW, by: "u1", userId: "", what: "settings", detail: "name, managers, slots, allowMultipleChars" });
        expect(updateRoster("nope", { name: "x" })).toBeNull();
    });

    it("an update that changes nothing writes no history line", () => {
        const r = createRoster({ name: "A" });
        expect(updateRoster(r.id, { name: "A" }).history).toHaveLength(1);
    });

    it("refuses to move a roster onto a category that has one", () => {
        createRoster({ name: "A", categoryId: "c1" });
        const b = createRoster({ name: "B", categoryId: "c2" });
        expect(() => updateRoster(b.id, { categoryId: "c1" })).toThrow(expect.objectContaining({ code: "category_taken" }));
        expect(updateRoster(b.id, { categoryId: "c3" }).categoryId).toBe("c3");
    });

    it("deletes a roster", () => {
        const r = createRoster({ name: "A" });
        expect(deleteRoster(r.id)).toBe(true);
        expect(deleteRoster(r.id)).toBe(false);
        expect(getRoster(r.id)).toBeNull();
    });
});

describe("stores/rosterStore members and history", () => {
    it("adds a member as core with char keys of the roster's version and its typed name", () => {
        const r = createRoster({ name: "F", versionId: "forever" });
        const m = upsertMember(r.id, "u1", { chars: ["Devi Res"] }, { actor: "o1", now: NOW });
        expect(m).toEqual({ status: "core", since: NOW, by: "o1", chars: ["forever~devi res"], charNames: { "forever~devi res": "Devi Res" }, note: "", trialUntil: null });
        const hist = getRoster(r.id).history;
        expect(hist[hist.length - 1]).toEqual({ at: NOW, by: "o1", userId: "u1", what: "member-added", detail: "core, forever~devi res" });
    });

    it("changes status (new since/by), note and trial date, and logs the change", () => {
        const r = createRoster({ name: "A" });
        upsertMember(r.id, "u1", { chars: ["kes"] }, { actor: "o1", now: "2026-01-01T00:00:00.000Z" });
        const m = upsertMember(r.id, "u1", { status: "trial", note: "neu", trialUntil: NOW }, { actor: "o2", now: NOW });
        expect(m).toMatchObject({ status: "trial", since: NOW, by: "o2", chars: ["kes"], note: "neu", trialUntil: NOW });
        const hist = getRoster(r.id).history;
        expect(hist[hist.length - 1].detail).toBe(`status core → trial; note; trialUntil ${NOW}`);
        // nothing changed: no new line
        upsertMember(r.id, "u1", { status: "trial" }, { actor: "o2", now: NOW });
        expect(getRoster(r.id).history).toHaveLength(hist.length);
    });

    it("keeps one char without allowMultipleChars", () => {
        const r = createRoster({ name: "A" });
        expect(upsertMember(r.id, "u1", { chars: ["A", "B"] }).chars).toEqual(["a"]);
        const multi = createRoster({ name: "B", allowMultipleChars: true });
        expect(upsertMember(multi.id, "u1", { chars: ["A", "B"] }).chars).toEqual(["a", "b"]);
    });

    it("returns null without roster or user and refuses member 501", () => {
        expect(upsertMember("nope", "u1", {})).toBeNull();
        const r = createRoster({ name: "A" });
        expect(upsertMember(r.id, "", {})).toBeNull();
        const members = {};
        for (let i = 0; i < LIMITS.members; i += 1) members[`u${i}`] = { status: "core" };
        const data = stored();
        data.rosters[r.id].members = members;
        fs.__store.set(ROSTERS_FILE, JSON.stringify(data));
        expect(() => upsertMember(r.id, "new", {})).toThrow(expect.objectContaining({ code: "member_limit" }));
        expect(upsertMember(r.id, "u1", { note: "still fine" }).note).toBe("still fine");
    });

    it("removes a member with a history line", () => {
        const r = createRoster({ name: "A" });
        upsertMember(r.id, "u1", {});
        expect(removeMember(r.id, "u1", { actor: "o1", now: NOW })).toBe(true);
        expect(removeMember(r.id, "u1")).toBe(false);
        expect(removeMember("nope", "u1")).toBe(false);
        const hist = getRoster(r.id).history;
        expect(hist[hist.length - 1]).toEqual({ at: NOW, by: "o1", userId: "u1", what: "member-removed", detail: "" });
    });

    it("marks a change caused by a Discord role as \"via Discord\" (#656)", () => {
        const r = createRoster({ name: "A" });
        upsertMember(r.id, "u1", { chars: ["Devi"] }, { now: NOW, via: "discord" });
        removeMember(r.id, "u1", { now: NOW, via: "discord" });
        const [, added, removed] = getRoster(r.id).history;
        expect(added).toEqual({ at: NOW, by: "", userId: "u1", what: "member-added", detail: "via Discord · core, devi" });
        expect(removed).toEqual({ at: NOW, by: "", userId: "u1", what: "member-removed", detail: "via Discord" });
    });

    it("appends history lines and caps them at the newest 500", () => {
        const r = createRoster({ name: "A" });
        expect(appendHistory(r.id, { by: "o1", userId: "u1", what: "role", detail: "added" }, { now: NOW })).toBe(true);
        expect(appendHistory(r.id, { detail: "no what" })).toBe(false);
        expect(appendHistory("nope", { what: "x" })).toBe(false);
        expect(getRoster(r.id).history[1]).toEqual({ at: NOW, by: "o1", userId: "u1", what: "role", detail: "added" });
        for (let i = 0; i < LIMITS.history; i += 1) appendHistory(r.id, { what: `e${i}` });
        const hist = getRoster(r.id).history;
        expect(hist).toHaveLength(LIMITS.history);
        expect(hist[hist.length - 1].what).toBe(`e${LIMITS.history - 1}`);
    });
});

describe("stores/rosterStore setFirstChars (the facade's write)", () => {
    it("sets first chars, adds new members as core and empties the chars of members left out", () => {
        const r = createRoster({ name: "A", categoryId: "c1" });
        upsertMember(r.id, "u1", { chars: ["Old"], status: "bench" });
        upsertMember(r.id, "u2", { chars: ["Two"] });
        upsertMember(r.id, "u3", {});
        expect(setFirstChars(r.id, { u1: { key: "new", name: "New" }, u4: { key: "four", name: "Four" } }, { actor: "o1", now: NOW })).toBe(true);
        const after = getRoster(r.id).members;
        expect(after.u1).toMatchObject({ status: "bench", chars: ["new"], charNames: { new: "New" } });
        expect(after.u2).toMatchObject({ status: "core", chars: [], charNames: {} });
        expect(after.u3.chars).toEqual([]);
        expect(after.u4).toMatchObject({ status: "core", since: NOW, by: "o1", chars: ["four"], charNames: { four: "Four" } });
        expect(setFirstChars("nope", {})).toBe(false);
    });

    it("puts the char first and keeps the others with allowMultipleChars", () => {
        const r = createRoster({ name: "A", allowMultipleChars: true });
        upsertMember(r.id, "u1", { chars: ["A", "B", "C"] });
        setFirstChars(r.id, { u1: { key: "c", name: "C" } });
        expect(getRoster(r.id).members.u1.chars).toEqual(["c", "a", "b"]);
    });
});

describe("stores/rosterStore migrateCategories", () => {
    const CATS = [
        { categoryId: "c1", guildId: "g1", name: "Donnerstag", versionId: "tbc", roleIds: ["10"], members: { u1: { key: "kes", name: "Kes-Realm" } } },
        { categoryId: "c2", guildId: "", name: "", versionId: "forever", roleIds: [], members: {} },
    ];

    it("creates one roster per category, remembers them and does nothing the second time", () => {
        const created = migrateCategories(CATS, { now: NOW });
        expect(created).toEqual([
            expect.objectContaining({ categoryId: "c1", name: "Donnerstag", guildId: "g1", members: 1, roleIds: 1 }),
            expect.objectContaining({ categoryId: "c2", name: "c2", guildId: "", members: 0, roleIds: 0 }),
        ]);
        const r = rosterForCategory("c1");
        expect(r).toMatchObject({ source: { kind: "migration" }, createdAt: NOW, roleIds: ["10"], versionId: "tbc" });
        expect(r.members.u1).toEqual({ status: "core", since: NOW, by: "", chars: ["kes"], charNames: { kes: "Kes-Realm" }, note: "", trialUntil: null });
        expect(stored().migratedCategories).toEqual(["c1", "c2"]);
        const before = fs.__store.get(ROSTERS_FILE);
        fs.writeFileSync.mockClear();
        expect(migrateCategories(CATS, { now: NOW })).toEqual([]);
        expect(fs.writeFileSync).not.toHaveBeenCalled();
        expect(fs.__store.get(ROSTERS_FILE)).toBe(before);
    });

    it("never touches an existing roster and never recreates a deleted one", () => {
        const own = createRoster({ name: "Eigenes", categoryId: "c1", roleIds: ["99"] });
        expect(migrateCategories(CATS, { now: NOW }).map((c) => c.categoryId)).toEqual(["c2"]);
        expect(getRoster(own.id)).toMatchObject({ name: "Eigenes", roleIds: ["99"], members: {} });
        deleteRoster(rosterForCategory("c2").id);
        expect(migrateCategories(CATS, { now: NOW })).toEqual([]);
        expect(rosterForCategory("c2")).toBeNull();
    });

    it("skips entries without a category", () => {
        expect(migrateCategories([{ categoryId: "" }, null])).toEqual([]);
        expect(fs.__store.has(ROSTERS_FILE)).toBe(false);
    });
});

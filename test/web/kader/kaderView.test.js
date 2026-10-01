// The Kaderplaner's view model (docs/kaderplaner.md): who the planner knows,
// what they are prefilled with and from where, the planner winning over the
// profile, attendance per raid category, names for every id, and the chosen
// Kader with the summaries.
const { buildKaderView, kaderPayload, mutationContext, lightContext, prefillOf, diffAgainst, rateOver } = require("../../../src/web/kader/kaderView");
const model = require("../../../src/services/kader/kaderModel");
const { U, CLASSES } = require("../../helpers/kaderFixtures");

const warrior = {
    key: "forever~aldric sturmwind", name: "Aldric Sturmwind", className: "Warrior", main: false,
    specs: [{ spec: "Warrior-Protection", gear: "ready" }, { spec: "Warrior-Fury", gear: "none" }], canTank: true, canHeal: false, logSpecs: ["Warrior-Fury"],
};
const druid = { key: "forever~mira sonnlicht", name: "Mira Sonnlicht", className: "Druid", main: true, specs: [{ spec: "Druid-Restoration", gear: "usable" }], canTank: false, canHeal: true, logSpecs: [] };

const source = (over = {}) => ({
    guildId: "g1",
    versionId: "forever",
    mainVersion: { id: "tbc", label: "TBC" },
    classes: CLASSES,
    buffs: { raid: [], party: [] },
    members: [
        { userId: U.a, displayName: "Aldric", avatarUrl: null, roleIds: ["r1"] },
        { userId: U.b, displayName: "Bea", avatarUrl: null, roleIds: [] },
        { userId: U.lead, displayName: "Kurt", avatarUrl: null, roleIds: ["r1"] },
    ],
    discordRoles: [{ id: "r1", name: "Raider", color: "", count: 2 }],
    profiles: [
        { userId: U.a, displayName: "Aldric (Profil)", characters: [warrior, druid], availability: ["mi", "do"], other: null },
        { userId: U.c, displayName: "Oldie", characters: [], availability: [], other: { name: "Oldie", className: "Mage", spec: "Mage-Fire", versionId: "tbc" } },
    ],
    logChars: { [U.d]: { name: "Kael", className: "Priest", spec: "Priest-Shadow" } },
    raidCategories: [
        { id: "c-mo", name: "Mo Raid", versionId: "tbc", versionLabel: "TBC", nights: 4 },
        { id: "c-do", name: "Do Raid", versionId: "tbc", versionLabel: "TBC", nights: 10 },
    ],
    attendance: [
        { userId: U.a, byCategory: { "c-mo": { attended: 3, counted: 4, nights: [{ date: "2026-12-18", eventId: "e1", title: "Hyjal", attended: true, reason: null }] } } },
        { userId: U.c, byCategory: { "c-mo": { attended: 1, counted: 4, nights: [] }, "c-do": { attended: 9, counted: 10, nights: [] }, "c-empty": { attended: 0, counted: 0, nights: [] } } },
    ],
    warnings: [],
    ...over,
});

function planner() {
    const p = model.normalizePlanner({
        v: 2,
        accounts: [{ userId: U.hand, displayName: "Hand" }],
        kaders: [{
            id: "k1", name: "Forever-Kader", leads: [U.lead],
            players: {
                [U.c]: { name: "Oldie", state: "selected" },
                [U.d]: { name: "Kael (Import)", state: "pool" },
                [U.a]: { state: "roster", decision: { className: "Warrior", spec: "Warrior-Protection" } },
            },
        }, { id: "k2", name: "Zweiter", players: { [U.b]: { name: "Bea", state: "bench" } } }],
    });
    return p;
}

describe("web/kader/kaderView", () => {
    it("knows profiles of the version, hand-added accounts and everybody in a Kader", () => {
        const view = buildKaderView({ source: source(), planner: planner(), kaderId: "k1" });
        expect(view.players.map((p) => p.userId)).toEqual([U.a, U.hand, U.c, U.d, U.b]);
        const byId = new Map(view.players.map((p) => [p.userId, p]));
        // the member list's name wins, then the account, the profile, the name the Kader kept
        expect(byId.get(U.a)).toMatchObject({ displayName: "Aldric", onServer: true, roleIds: ["r1"], hasProfile: true });
        expect(byId.get(U.hand)).toMatchObject({ displayName: "Hand", manual: true, onServer: false });
        expect(byId.get(U.c)).toMatchObject({ displayName: "Oldie", characters: [], availability: [] });
        expect(byId.get(U.d).displayName).toBe("Kael (Import)");
    });

    it("prefills from the planner, the profile (another version's main too) and the logs", () => {
        const view = buildKaderView({ source: source(), planner: planner(), kaderId: "k1" });
        const byId = new Map(view.players.map((p) => [p.userId, p]));
        expect(byId.get(U.a).prefill).toEqual({ name: "Mira Sonnlicht", className: "Druid", spec: "Druid-Restoration", source: "profile", versionId: "" });
        expect(byId.get(U.c).prefill).toEqual({ name: "Oldie", className: "Mage", spec: "Mage-Fire", source: "profile", versionId: "tbc" });
        expect(byId.get(U.d).prefill).toEqual({ name: "Kael", className: "Priest", spec: "Priest-Shadow", source: "logs", versionId: "" });
        expect(byId.get(U.hand).prefill).toBeNull();
        const planned = prefillOf({ assignment: { characters: [{ id: "x", name: "Neu Name", className: "Mage", specs: [{ spec: "Mage-Frost", main: true }] }], activeCharacterId: "x" }, profile: null, logChar: null });
        expect(planned).toMatchObject({ className: "Mage", spec: "Mage-Frost", source: "planner" });
    });

    it("carries attendance per raid category and the server's raid categories; the page sums the Kader's pick", () => {
        const view = buildKaderView({ source: source(), planner: planner(), kaderId: "k1" });
        const byId = new Map(view.players.map((p) => [p.userId, p]));
        expect(byId.get(U.a).attendance).toEqual({ "c-mo": { attended: 3, counted: 4, nights: [{ date: "2026-12-18", title: "Hyjal", attended: true, reason: null }] } });
        // a category that counted no night for the account is left out
        expect(Object.keys(byId.get(U.c).attendance)).toEqual(["c-mo", "c-do"]);
        expect(byId.get(U.c).attendance["c-do"]).toMatchObject({ attended: 9, counted: 10 });
        // nothing counted at all: null, the page shows "—"
        expect(byId.get(U.b).attendance).toBeNull();
        expect(byId.get(U.a)).not.toHaveProperty("attendanceMain");
        expect(view.raidCategories.map((c) => [c.id, c.name, c.nights])).toEqual([["c-mo", "Mo Raid", 4], ["c-do", "Do Raid", 10]]);
        // a Kader stored before the setting existed counts in no category yet
        expect(view.kader.attendanceCategories).toEqual([]);
        expect(view.mainVersion).toEqual({ id: "tbc", label: "TBC" });
    });

    it("sums attendance over the picked categories only", () => {
        const by = { mo: { attended: 9, counted: 11 }, do: { attended: 7, counted: 10 } };
        expect(rateOver(by, ["mo", "do"])).toBeCloseTo(16 / 21);
        expect(rateOver(by, ["do"])).toBe(0.7);
        // an unknown or uncounted category adds nothing; nothing picked or nothing counted is null
        expect(rateOver(by, ["mo", "pug"])).toBeCloseTo(9 / 11);
        expect(rateOver(by, [])).toBeNull();
        expect(rateOver(null, ["mo"])).toBeNull();
    });

    it("lets the planner's characters win and marks what deviates from the profile", () => {
        const p = planner();
        p.assignments[U.a] = { characters: [{ id: "c1", name: "Aldric Sturmwind", nameStyle: "forever", className: "Warrior", specs: [{ spec: "Warrior-Fury", main: true, gear: "ready" }], canTank: false, canHeal: false, onlineKey: "forever~aldric sturmwind" }], activeCharacterId: "c1" };
        const view = buildKaderView({ source: source(), planner: p, kaderId: "k1" });
        const a = view.players.find((x) => x.userId === U.a);
        expect(a).toMatchObject({ hasOverride: true, activeCharacterId: "c1", differs: ["mainSpec", "tank"] });
        expect(a.prefill.source).toBe("planner");
        const idx = new Map(CLASSES.map((c) => [c.key, c]));
        expect(diffAgainst({ name: "x", className: "Druid", specs: [], canTank: false, canHeal: false }, null, idx)).toEqual(["notInProfile"]);
    });

    it("hands out members with their prefill, names for every id, the summaries and the chosen Kader", () => {
        const view = buildKaderView({ source: source(), planner: planner(), kaderId: "k1" });
        expect(view.members.find((m) => m.userId === U.a)).toMatchObject({ displayName: "Aldric", roleIds: ["r1"], prefill: { spec: "Druid-Restoration" } });
        expect(view.names).toMatchObject({ [U.lead]: "Kurt", [U.hand]: "Hand", [U.c]: "Oldie", [U.b]: "Bea" });
        expect(view.kaders).toEqual([
            { id: "k1", name: "Forever-Kader", leads: [U.lead], createdAt: "", createdBy: "", counts: { pool: 1, selected: 1, provisional: 0, roster: 1, bench: 0, tentative: 0 }, questions: 0 },
            { id: "k2", name: "Zweiter", leads: [], createdAt: "", createdBy: "", counts: { pool: 0, selected: 0, provisional: 0, roster: 0, bench: 1, tentative: 0 }, questions: 0 },
        ]);
        expect(view.kader.id).toBe("k1");
        expect(view.kader.players[U.a].decision).toEqual({ className: "Warrior", spec: "Warrior-Protection" });
        expect(buildKaderView({ source: source(), planner: planner(), kaderId: "nope" }).kader).toBeNull();
        expect(view.discordRoles).toEqual([{ id: "r1", name: "Raider", color: "", count: 2 }]);
    });

    it("answers a change inside a Kader with that Kader and the summaries", () => {
        const payload = kaderPayload(planner(), "k2");
        expect(payload.kader.id).toBe("k2");
        expect(payload.kaders.map((k) => k.id)).toEqual(["k1", "k2"]);
        expect(kaderPayload(planner(), "gone").kader).toBeNull();
    });

    it("gives the mutators their helpers", () => {
        const ctx = mutationContext({ source: source(), planner: planner(), actor: U.lead, now: "t" });
        expect(ctx).toMatchObject({ actor: U.lead, now: "t" });
        expect([...ctx.memberIds]).toEqual([U.a, U.b, U.lead]);
        expect(ctx.knownIds.has(U.c)).toBe(true);
        expect(ctx.knownIds.has(U.d)).toBe(true);
        expect(ctx.prefillOf(U.d)).toMatchObject({ className: "Priest", spec: "Priest-Shadow" });
        // the planner being changed wins over the one the context was built from (an account just given a character)
        const changed = planner();
        changed.assignments[U.d] = { characters: [{ id: "c9", name: "Neu Name", nameStyle: "forever", className: "Mage", specs: [{ spec: "Mage-Frost", main: true, gear: "none" }], canTank: false, canHeal: false }], activeCharacterId: "c9" };
        expect(ctx.prefillOf(U.d, changed)).toMatchObject({ className: "Mage", spec: "Mage-Frost", source: "planner" });
        // attendance over the Kader's categories: none picked counts as 0
        expect(ctx.rateOf(U.a, ["c-mo"])).toBe(0.75);
        expect(ctx.rateOf(U.c, ["c-do"])).toBe(0.9);
        expect(ctx.rateOf(U.c, ["c-mo", "c-do"])).toBeCloseTo(10 / 14);
        expect(ctx.rateOf(U.c)).toBe(0);
        expect(ctx.rateOf(U.b, ["c-mo"])).toBe(0);
        expect([...ctx.raidCategoryIds]).toEqual(["c-mo", "c-do"]);
        expect(ctx.classes.get("Mage").specs.map((s) => s.key)).toEqual(["Mage-Frost", "Mage-Fire"]);
        const light = lightContext({ rules: { classes: CLASSES }, actor: U.lead });
        expect(light.classes.size).toBe(CLASSES.length);
        expect(light.memberIds.size).toBe(0);
    });
});

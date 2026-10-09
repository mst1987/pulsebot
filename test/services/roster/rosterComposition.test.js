// rosterComposition (#657): places per role against the slots, classes and the
// buffs of the version's rule set - class and spec of each member through
// memberSpec.js's chain (override > signup > logs > profile > class).
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const rosterStore = require("../../../src/stores/rosterStore");
const raiderProfileStore = require("../../../src/stores/raiderProfileStore");
const characterStore = require("../../../src/stores/characterStore");
const { rosterComposition, memberCharacter } = require("../../../src/services/roster/rosterComposition");

const add = (userId, name, className, spec) => raiderProfileStore.addCharacter(userId, { name, className, specs: [spec] });
/** An attendance context with no nights and no logs: nothing but the stores speaks. */
const EMPTY = { raidsByCategory: new Map(), allRaidsByCategory: new Map(), roleByKey: {} };

let roster;
beforeEach(() => {
    fs.__store.clear();
    roster = rosterStore.createRoster({ name: "Raid", slots: { total: 10, tank: 2, healer: 3, bench: 2 } });
    add("100001", "Brumm", "Warrior", "Warrior-Protection");
    add("100002", "Devi", "Priest", "Priest-Holy");
    add("100003", "Keslight", "Mage", "Mage-Frost");
    add("100004", "Klinge", "Rogue", "Rogue-Combat");
    add("100005", "Ersatz", "Mage", "Mage-Fire");
    rosterStore.upsertMember(roster.id, "100001", { status: "core", chars: ["brumm"] });
    rosterStore.upsertMember(roster.id, "100002", { status: "trial", chars: ["devi"] });
    rosterStore.upsertMember(roster.id, "100003", { status: "core", chars: ["keslight"] });
    rosterStore.upsertMember(roster.id, "100004", { status: "core", chars: ["klinge"] });
    rosterStore.upsertMember(roster.id, "100005", { status: "bench", chars: ["ersatz"] });
    rosterStore.upsertMember(roster.id, "100006", { status: "core", chars: ["Handname"] });
    rosterStore.upsertMember(roster.id, "100007", { status: "pause" });
});

const comp = (r = rosterStore.getRoster(roster.id), ctx = EMPTY) => rosterComposition(r, { ctx });

describe("services/roster/rosterComposition", () => {
    it("counts roles of core and trial against the slots, bench apart", () => {
        const c = comp();
        expect(c.counts).toEqual({ core: 4, trial: 1, bench: 1, pause: 1 });
        expect(c.roles).toEqual([
            { role: "tank", target: 2, actual: 1 },
            { role: "healer", target: 3, actual: 1 },
            { role: "dps", target: 5, actual: 2 },
        ]);
        expect(c.dps).toEqual({ melee: 1, ranged: 1 });
        expect(c.unknown).toBe(1);
        expect(c.bench).toEqual({ target: 2, actual: 1 });
        expect(c.open).toBe(5);
    });

    it("lists the classes in the roster, most first, with the rule set's labels", () => {
        const c = comp();
        expect(c.classes.map((x) => [x.className, x.count])).toEqual([["Mage", 1], ["Priest", 1], ["Rogue", 1], ["Warrior", 1]]);
        expect(c.classes.find((x) => x.className === "Priest")).toEqual(expect.objectContaining({ label: "Priester", labelEn: "Priest", color: expect.any(String) }));
    });

    it("marks the buffs of the rule set the roster covers, with who brings them", () => {
        const c = comp();
        expect(c.buffsAvailable).toBe(true);
        const fort = c.buffs.find((b) => b.key === "fortitude");
        expect(fort).toEqual(expect.objectContaining({ scope: "raid", covered: true, providers: ["100002"] }));
        const motw = c.buffs.find((b) => b.key === "motw");
        expect(motw).toEqual(expect.objectContaining({ covered: false, providers: [] }));
        // the benched mage brings nothing
        expect(c.buffs.find((b) => b.key === "intellect").providers).toEqual(["100003"]);
    });

    it("says who counts without class or spec and why, and where the specs came from", () => {
        const c = comp();
        expect(c.unresolved).toEqual([{ userId: "100006", displayName: "Handname", character: "Handname", className: "", reason: "no_class" }]);
        expect(c.sources).toEqual({ override: 0, signup: 0, logs: 0, profile: 4, class: 0 });
        expect(c.members.find((m) => m.userId === "100001")).toEqual({ userId: "100001", className: "Warrior", spec: "Warrior-Protection", role: "tank", source: "profile" });
    });

    it("knows no class for a character typed by hand or a member without one", () => {
        const fresh = rosterStore.getRoster(roster.id);
        expect(memberCharacter("100006", fresh.members["100006"], "tbc")).toBeNull();
        expect(memberCharacter("100007", fresh.members["100007"], "tbc")).toBeNull();
        expect(memberCharacter("100001", fresh.members["100001"], "tbc")).toEqual({ className: "Warrior", spec: "Warrior-Protection", role: "tank", source: "profile" });
    });

    it("never counts open places below zero", () => {
        const small = rosterStore.updateRoster(roster.id, { slots: { total: 2, tank: 0, healer: 0 } });
        expect(comp(small).open).toBe(0);
    });
});

describe("services/roster/rosterComposition the resolution chain", () => {
    const CAT = "700000000000000001";
    let raid;
    beforeEach(() => {
        raid = rosterStore.createRoster({ name: "Mo-Raider", categoryId: CAT, slots: { total: 10, tank: 2, healer: 3 } });
        // the owl of the bug report: Resto first in the profile, plays Balance
        raiderProfileStore.addCharacter("200001", { name: "Gentletwowl", className: "Druid", specs: [{ key: "Druid-Restoration" }, { key: "Druid-Balance" }] });
        rosterStore.upsertMember(raid.id, "200001", { status: "core", chars: ["gentletwowl"] });
    });
    const night = (signUps) => ({ ...EMPTY, allRaidsByCategory: new Map([[CAT, [{ id: "e1", startTime: 1, signUps, logs: [] }]]]) });
    const owl = (c) => c.members.find((m) => m.userId === "200001");

    it("takes the profile's first spec when nothing else speaks", () => {
        const c = comp(rosterStore.getRoster(raid.id));
        expect(owl(c)).toMatchObject({ spec: "Druid-Restoration", source: "profile", role: "healer" });
        expect(c.buffs.find((b) => b.key === "moonkinAura").covered).toBe(false);
    });

    it("prefers the profile spec of the role the logs saw", () => {
        const c = comp(rosterStore.getRoster(raid.id), { ...EMPTY, roleByKey: { gentletwowl: "dps" } });
        expect(owl(c)).toMatchObject({ spec: "Druid-Balance", source: "profile" });
    });

    it("resolves the Balance druid from the logs (character cache)", () => {
        characterStore.saveCharacter("Gentletwowl", { className: "Druid", spec: "Balance", source: "report" });
        const c = comp(rosterStore.getRoster(raid.id));
        expect(owl(c)).toMatchObject({ spec: "Druid-Balance", source: "logs", role: "dps" });
        const moonkin = c.buffs.find((b) => b.key === "moonkinAura");
        expect(moonkin).toMatchObject({ covered: true, providers: ["200001"] });
    });

    it("resolves the Balance druid from the last signup of the category, over the logs", () => {
        characterStore.saveCharacter("Gentletwowl", { className: "Druid", spec: "Restoration", source: "report" });
        const ctx = night([{ userId: "200001", status: "signed", characters: [{ character: "Gentletwowl", spec: "Druid-Balance" }] }]);
        expect(owl(comp(rosterStore.getRoster(raid.id), ctx))).toMatchObject({ spec: "Druid-Balance", source: "signup" });
    });

    it("skips a signup with another character, an absence and a Raid-Helper spec of another class", () => {
        const ctx = night([
            { userId: "200001", status: "signed", characters: [{ character: "Twink", spec: "Mage-Frost" }] },
            { userId: "200001", status: "absence", specName: "Absence" },
            { userId: "200001", status: "signed", specName: "Frost" },
        ]);
        expect(owl(comp(rosterStore.getRoster(raid.id), ctx))).toMatchObject({ spec: "Druid-Restoration", source: "profile" });
        // a Raid-Helper signup naming a druid spec counts
        const rh = night([{ userId: "200001", status: "signed", specName: "Balance" }]);
        expect(owl(comp(rosterStore.getRoster(raid.id), rh))).toMatchObject({ spec: "Druid-Balance", source: "signup" });
    });

    it("lets the orga's spec win over everything, unless it is another class", () => {
        const ctx = night([{ userId: "200001", status: "signed", characters: [{ character: "Gentletwowl", spec: "Druid-Balance" }] }]);
        rosterStore.upsertMember(raid.id, "200001", { spec: "Druid-Feral" });
        expect(owl(comp(rosterStore.getRoster(raid.id), ctx))).toMatchObject({ spec: "Druid-Feral", source: "override", role: "dps" });
        rosterStore.upsertMember(raid.id, "200001", { spec: "Mage-Frost" });
        expect(owl(comp(rosterStore.getRoster(raid.id), ctx))).toMatchObject({ spec: "Druid-Balance", source: "signup" });
    });

    it("counts a member without profile as a mage through the logs (the second mage)", () => {
        add("200002", "Frostie", "Mage", "Mage-Frost");
        rosterStore.upsertMember(raid.id, "200002", { status: "core", chars: ["frostie"] });
        characterStore.saveCharacter("Zappy", { className: "Mage", spec: "Arcane", source: "report" });
        rosterStore.upsertMember(raid.id, "200003", { status: "core", chars: ["Zappy"] });
        const c = comp(rosterStore.getRoster(raid.id));
        expect(c.classes.find((x) => x.className === "Mage").count).toBe(2);
        expect(c.members.find((m) => m.userId === "200003")).toMatchObject({ className: "Mage", spec: "Mage-Arcane", source: "logs" });
        expect(c.buffs.find((b) => b.key === "intellect").providers.sort()).toEqual(["200002", "200003"]);
    });

    it("counts a class without spec among the classes, not in roles or buffs, and lists it", () => {
        characterStore.saveCharacter("Nospec", { className: "Mage", source: "export" });
        rosterStore.upsertMember(raid.id, "200004", { status: "core", chars: ["Nospec"] });
        const c = comp(rosterStore.getRoster(raid.id));
        expect(c.classes.find((x) => x.className === "Mage").count).toBe(1);
        expect(c.members.find((m) => m.userId === "200004")).toMatchObject({ className: "Mage", spec: "", source: "class", role: "" });
        expect(c.unresolved).toEqual([expect.objectContaining({ userId: "200004", character: "Nospec", className: "Mage", reason: "no_spec" })]);
        expect(c.unknown).toBe(1);
        expect(c.sources.class).toBe(1);
        // the log saw it play dps: it counts as damage, still without melee/ranged
        const withRole = comp(rosterStore.getRoster(raid.id), { ...EMPTY, roleByKey: { nospec: "dps" } });
        expect(withRole.roles.find((r) => r.role === "dps").actual).toBe(1);
        expect(withRole.dps).toEqual({ melee: 0, ranged: 0 });
        expect(withRole.unknown).toBe(0);
    });

    it("lists a member without any character", () => {
        rosterStore.upsertMember(raid.id, "200005", { status: "trial" });
        const c = comp(rosterStore.getRoster(raid.id));
        expect(c.unresolved).toEqual([expect.objectContaining({ userId: "200005", reason: "no_char", character: "" })]);
    });
});

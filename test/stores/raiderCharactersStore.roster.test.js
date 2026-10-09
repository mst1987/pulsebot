// The facade of raiderCharactersStore over the rosters (#653): a category with
// a roster reads from it and writes into it; the answers stay the same before
// and after the migration (golden master).
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../src/config/paths");
const chars = require("../../src/stores/raiderCharactersStore");
const rosterStore = require("../../src/stores/rosterStore");
const { saveCharacter } = require("../../src/stores/characterStore");
const { migrateCategoryRosters } = require("../../src/stores/settingsMigration");

const CONFIG_FILE = settingsPath("config.json");
const PROFILES_FILE = settingsPath("raider-profiles.json");
const U1 = "200000000000000001";
const U2 = "200000000000000002";
const U3 = "200000000000000003";
const NOW = "2026-10-09T18:00:00.000Z";

// An install as it is today: roles on two categories, a Forever category,
// names with realm suffix and odd casing, a category with assignments but no
// roles and an empty map someone left in the file.
const CONFIG = {
    categoryIds: ["c1", "cF"],
    categoryRoles: { c1: ["10", "11"], cR: ["12"] },
    categoryVersion: { cF: "forever" },
    discordServers: { eventGuilds: [{ guildId: "1100000000000000001" }] },
};
const ASSIGNMENTS = {
    c1: { [U1]: "Keslight-Thunderstrike", [U2]: "elesham" },
    cF: { [U1]: "Devi Res", [U3]: "Mage" },
    cX: { [U3]: "Mage" },
    empty: {},
};

function seed() {
    fs.__store.set(CONFIG_FILE, JSON.stringify(CONFIG));
    fs.__store.set(chars.RAIDER_CHARACTERS_FILE, JSON.stringify(ASSIGNMENTS));
    saveCharacter("Keslight", { className: "Shaman", spec: "Restoration", source: "manual" });
    saveCharacter("Mage", { className: "Mage", spec: "Frost", source: "manual" });
}

function snapshot() {
    return {
        c1: chars.getCategoryAssignments("c1"),
        cF: chars.getCategoryAssignments("cF"),
        cX: chars.getCategoryAssignments("cX"),
        cR: chars.getCategoryAssignments("cR"),
        unknown: chars.getCategoryAssignments("nope"),
        all: chars.listAllAssignments(),
        allOrder: Object.keys(chars.listAllAssignments()),
        memberOrder: Object.keys(chars.getCategoryAssignments("c1")),
        u1: chars.charactersForUser(U1),
        u3: chars.charactersForUser(U3),
        profilesC1: chars.resolveAssignmentProfiles("c1"),
        profilesCF: chars.resolveAssignmentProfiles("cF"),
    };
}

beforeEach(() => {
    fs.__store.clear();
});

describe("stores/raiderCharactersStore over rosters: golden master", () => {
    it("answers exactly the same before and after the migration", () => {
        seed();
        const before = snapshot();
        const lines = migrateCategoryRosters({ now: NOW });
        expect(lines).toHaveLength(1);
        // c1, cF (assignments + roles), cR (roles only), cX (assignments only); "empty" has neither
        expect(rosterStore.listRosters().map((r) => r.categoryId).sort()).toEqual(["c1", "cF", "cR", "cX"]);
        expect(snapshot()).toEqual(before);
        // and the answers really come from the rosters now
        expect(rosterStore.rosterForCategory("cF").members[U1].chars).toEqual(["forever~devi res"]);
        expect(rosterStore.rosterForCategory("c1").members[U1].chars).toEqual(["keslight"]);
    });

    it("the old file stays as it was", () => {
        seed();
        const file = fs.__store.get(chars.RAIDER_CHARACTERS_FILE);
        migrateCategoryRosters({ now: NOW });
        expect(fs.__store.get(chars.RAIDER_CHARACTERS_FILE)).toBe(file);
        expect(chars.readLegacyAssignments()).toEqual(ASSIGNMENTS);
    });

    it("the documented example values", () => {
        seed();
        migrateCategoryRosters({ now: NOW });
        expect(chars.getCategoryAssignments("c1")).toEqual({ [U1]: "Keslight-Thunderstrike", [U2]: "elesham" });
        expect(chars.charactersForUser(U3)).toEqual([{ character: "Mage", categoryIds: ["cF", "cX"] }]);
        expect(chars.resolveAssignmentProfiles("c1")[U1]).toEqual({ character: "Keslight-Thunderstrike", className: "Shaman", spec: "Restoration" });
        expect(chars.listAllAssignments().empty).toEqual({});
    });
});

describe("stores/raiderCharactersStore over rosters: writing", () => {
    beforeEach(() => {
        seed();
        migrateCategoryRosters({ now: NOW });
    });

    it("setCategoryAssignments writes into the roster and reads back the same map", () => {
        const saved = chars.setCategoryAssignments("c1", { [U1]: "Kesneu", [U3]: " Mage ", [U2]: "" }, { actor: "900" });
        expect(saved).toEqual({ [U1]: "Kesneu", [U3]: "Mage" });
        expect(chars.getCategoryAssignments("c1")).toEqual(saved);
        const roster = rosterStore.rosterForCategory("c1");
        // U2 lost his character but stays in the roster; U3 joined as core
        expect(roster.members[U2]).toMatchObject({ status: "core", chars: [] });
        expect(roster.members[U3]).toMatchObject({ status: "core", chars: ["mage"], by: "900" });
        // the old file is not written for a category with a roster
        expect(chars.readLegacyAssignments().c1).toEqual(ASSIGNMENTS.c1);
    });

    it("keeps a member's status when his character changes", () => {
        const roster = rosterStore.rosterForCategory("c1");
        rosterStore.upsertMember(roster.id, U2, { status: "bench" });
        chars.setCategoryAssignments("c1", { [U1]: "Keslight-Thunderstrike", [U2]: "Priest" });
        expect(rosterStore.rosterForCategory("c1").members[U2]).toMatchObject({ status: "bench", chars: ["priest"] });
    });

    it("emptying a roster category drops it from listAllAssignments, like removing the file entry did", () => {
        chars.setCategoryAssignments("cX", {});
        expect(chars.getCategoryAssignments("cX")).toEqual({});
        expect(chars.listAllAssignments()).not.toHaveProperty("cX");
    });

    it("forever keys for a forever roster", () => {
        chars.setCategoryAssignments("cF", { [U2]: "Holy Light" });
        expect(rosterStore.rosterForCategory("cF").members[U2].chars).toEqual(["forever~holy light"]);
        expect(chars.getCategoryAssignments("cF")).toEqual({ [U2]: "Holy Light" });
    });

    it("a category without roster still uses the file", () => {
        chars.setCategoryAssignments("cNew", { [U1]: "Kes" });
        expect(chars.readLegacyAssignments().cNew).toEqual({ [U1]: "Kes" });
        expect(chars.listAllAssignments().cNew).toEqual({ [U1]: "Kes" });
        chars.setCategoryAssignments("cNew", {});
        expect(chars.readLegacyAssignments()).not.toHaveProperty("cNew");
    });
});

describe("stores/raiderCharactersStore over rosters: names of keys without a stored name", () => {
    it("profile name, then character cache, then the key's name part", () => {
        fs.__store.set(PROFILES_FILE, JSON.stringify({ profiles: { [U1]: { characters: [{ name: "Devi Res", versionId: "forever", className: "Paladin" }] } } }));
        saveCharacter("Thrall", { className: "Shaman", source: "manual" });
        rosterStore.createRoster({
            name: "R", categoryId: "cK", versionId: "forever",
            members: { [U1]: { chars: ["forever~devi res"] }, [U2]: { chars: ["thrall"] }, [U3]: { chars: ["forever~nobody"] }, [U3 + "9"]: { chars: [] } },
        });
        expect(chars.getCategoryAssignments("cK")).toEqual({ [U1]: "Devi Res", [U2]: "Thrall", [U3]: "nobody" });
    });

    it("a roster category the file never had is listed after the file's categories", () => {
        fs.__store.set(chars.RAIDER_CHARACTERS_FILE, JSON.stringify({ a: { [U1]: "Kes" } }));
        const r = rosterStore.createRoster({ name: "R", categoryId: "b" });
        rosterStore.upsertMember(r.id, U2, { chars: ["Mage"] });
        expect(Object.keys(chars.listAllAssignments())).toEqual(["a", "b"]);
        expect(chars.charactersForUser(U2)).toEqual([{ character: "Mage", categoryIds: ["b"] }]);
    });
});

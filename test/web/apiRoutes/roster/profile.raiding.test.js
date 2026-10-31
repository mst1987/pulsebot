// GET /api/profile/raiding through the real router: the character tabs of
// "Mein Profil" - who may read it, that it answers the session's own account
// only, and one game version at a time.
jest.mock("../../../../src/web/http/auth", () => ({
    getUser: jest.fn(),
    getRealUser: jest.fn(),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
    // the active server: loot shows only on its own server (#919)
    getActiveGuild: jest.fn(() => "g1"),
}));
jest.mock("../../../../src/stores/settings/settingsStore", () => ({
    ...jest.requireActual("../../../../src/stores/settings/settingsStore"),
    getConfig: jest.fn(() => ({ mainVersion: "forever" })),
}));
jest.mock("../../../../src/services/versions/storedVersion", () => ({
    ...jest.requireActual("../../../../src/services/versions/storedVersion"),
    storedVersionOf: (id) => ({ ev_tbc: "tbc", ev_forever: "forever" })[id] || "",
}));

const { body, status, routerClient } = require("../../../helpers/http");
const { getUser } = require("../../../../src/web/http/auth");
const { getConfig } = require("../../../../src/stores/settings/settingsStore");
const profiles = require("../../../../src/stores/roster/raiderProfileStore");
const rosterStore = require("../../../../src/stores/roster/rosterStore");
const lootStore = require("../../../../src/stores/loot/lootStore");
const dungeonRuns = require("../../../../src/stores/roster/dungeonRunStore");
const { tempStoreFile } = require("../../../helpers/tempStore");
const { get } = routerClient(require("../../../../src/web/apiRoutes/roster/profile"));

const ME = { id: "100000000000000001", name: "Devihra", isAdmin: false, access: { signup: { read: true, write: true } } };
const OTHER = { id: "100000000000000002", name: "Bob", isAdmin: false, access: { signup: { read: true, write: true } } };
const LOOT_ONLY = { id: "100000000000000003", name: "Lo", isAdmin: false, access: { loot: { read: true, write: false } } };

beforeAll(() => {
    profiles.useFile(tempStoreFile("prr-profiles.json"));
    rosterStore.useFile(tempStoreFile("prr-rosters.json"));
    lootStore.useFile(tempStoreFile("prr-loot.json"));
    dungeonRuns.useFile(tempStoreFile("prr-dungeons.json"));
    profiles.addCharacter(ME.id, { name: "Borka", className: "Druid", source: "log", versionId: "tbc" });
    profiles.addCharacter(ME.id, { name: "Devi Res", className: "Mage", source: "log", versionId: "forever" });
    profiles.addCharacter(OTHER.id, { name: "Bobby Tank", className: "Warrior", source: "log", versionId: "forever" });
    const roster = rosterStore.createRoster({ name: "Forever Donnerstag", categoryId: "cat1", versionId: "forever" });
    rosterStore.upsertMember(roster.id, ME.id, { status: "core", chars: ["Devi Res"] });
    rosterStore.upsertMember(roster.id, OTHER.id, { status: "trial", chars: ["Bobby Tank"] });
    lootStore.addImport("ev_forever", [{ source: "manual", rawId: "r1", character: "Devi Res", characterKey: "devi res", itemId: 1, itemName: "Staff", awardedAt: 1790000000000 }], { eventLabel: "Forever Do", guildId: "g1" });
    lootStore.addImport("ev_tbc", [{ source: "manual", rawId: "r2", character: "Borka", characterKey: "borka", itemId: 2, itemName: "Helm", awardedAt: 1790000000000 }], { eventLabel: "SSC", guildId: "g1" });
    dungeonRuns.update(() => ({
        runs: [{ id: "dr_1", versionId: "forever", dungeon: "The Deadmines", seconds: 1800, start: 1, at: 2, medal: "gold", members: [{ guid: "", name: "Devi Res", class: "MAGE" }], addonIds: ["a"] }],
        characters: [],
    }));
});
afterAll(() => {
    for (const s of [profiles, rosterStore, lootStore, dungeonRuns]) s.useFile(null);
});
beforeEach(() => {
    getUser.mockReturnValue(ME);
    getConfig.mockReturnValue({ mainVersion: "forever" });
});

describe("GET /api/profile/raiding", () => {
    it("answers the main version without ?version=: the own roster, loot and dungeon runs", async () => {
        const data = body(await get("/api/profile/raiding"));
        expect(data.versionId).toBe("forever");
        expect(data.rosters).toEqual([expect.objectContaining({ name: "Forever Donnerstag", status: "core", chars: ["forever~devi res"] })]);
        expect(Object.keys(data.characters)).toEqual(["forever~devi res"]);
        expect(data.characters["forever~devi res"].loot).toMatchObject({ count: 1, items: [expect.objectContaining({ itemName: "Staff" })] });
        expect(data.characters["forever~devi res"].dungeons).toMatchObject({ runs: 1, medals: { gold: 1, silver: 0, bronze: 0 } });
    });

    it("answers the version asked for, never a mix - TBC has no dungeon block", async () => {
        const data = body(await get("/api/profile/raiding", { version: "tbc" }));
        expect(data.versionId).toBe("tbc");
        expect(data.rosters).toEqual([]);
        expect(Object.keys(data.characters)).toEqual(["borka"]);
        expect(data.characters.borka).toMatchObject({ loot: { count: 1 }, dungeons: null });
        expect(data.dungeonTimes).toBe(false);
    });

    it("sends no dungeon data while the feature „Dungeon-Bestzeiten“ is switched off for the version", async () => {
        getConfig.mockReturnValue({ mainVersion: "forever", versionSettings: { forever: { disabled: ["dungeonTimes"] } } });
        const data = body(await get("/api/profile/raiding"));
        expect(data.dungeonTimes).toBe(false);
        expect(data.characters["forever~devi res"].dungeons).toBeNull();
    });

    it("answers only the main version while the other versions are hidden", async () => {
        getConfig.mockReturnValue({ mainVersion: "forever", hideOtherVersions: true });
        expect(body(await get("/api/profile/raiding", { version: "tbc" })).versionId).toBe("forever");
    });

    it("is the session's own account only: another raider's entries never come along, a userId is ignored", async () => {
        const data = body(await get("/api/profile/raiding", { userId: OTHER.id }));
        expect(JSON.stringify(data)).not.toMatch(/Bobby|100000000000000002/);
        getUser.mockReturnValue(OTHER);
        const theirs = body(await get("/api/profile/raiding"));
        expect(Object.keys(theirs.characters)).toEqual(["forever~bobby tank"]);
        expect(theirs.rosters.map((r) => r.status)).toEqual(["trial"]);
    });

    it("is open with signup (base access) and closed to an account without it", async () => {
        getUser.mockReturnValue(LOOT_ONLY);
        expect(status(await get("/api/profile/raiding"))).toBe(403);
        getUser.mockReturnValue(null);
        expect(status(await get("/api/profile/raiding"))).toBe(401);
    });
});

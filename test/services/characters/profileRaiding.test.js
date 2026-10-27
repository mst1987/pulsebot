// The character tabs of "Mein Profil" (services/characters/profileRaiding.js):
// the own roster memberships, loot and LevelHelper data of one game version,
// read from the stores - versions strictly apart, only the caller's own.
jest.mock("../../../src/services/events/storedVersion", () => ({
    storedVersionOf: (id) => ({ ev_tbc: "tbc", ev_forever: "forever" })[id] || "",
}));

const profiles = require("../../../src/stores/raiderProfileStore");
const rosterStore = require("../../../src/stores/rosterStore");
const lootStore = require("../../../src/stores/lootStore");
const dungeonRuns = require("../../../src/stores/dungeonRunStore");
const { tempStoreFile } = require("../../helpers/tempStore");
const { profileRaiding, storedCharacterOf, LOOT_SHOWN } = require("../../../src/services/characters/profileRaiding");

const ME = "100000000000000001";
const OTHER = "100000000000000002";

const loot = (name, n, eventId) => Array.from({ length: n }, (_, i) => ({
    source: "manual", rawId: `${name}-${eventId}-${i}`, character: name, characterKey: name.toLowerCase(), realm: "",
    itemId: 1000 + i, itemName: `Item ${i}`, awardedAt: 1790000000000 + i * 1000,
}));

const run = (over) => ({
    id: "dr_1", versionId: "forever", guild: "", dungeon: "The Deadmines", seconds: 1800, start: 1791700000, at: 1791702000,
    medal: "gold", members: [{ guid: "g1", name: "Devi Res", class: "MAGE" }, { guid: "g9", name: "Bob", class: "WARRIOR" }], addonIds: ["a"],
    ...over,
});

beforeAll(() => {
    profiles.useFile(tempStoreFile("pr-profiles.json"));
    rosterStore.useFile(tempStoreFile("pr-rosters.json"));
    lootStore.useFile(tempStoreFile("pr-loot.json"));
    dungeonRuns.useFile(tempStoreFile("pr-dungeons.json"));
});
afterAll(() => {
    for (const s of [profiles, rosterStore, lootStore, dungeonRuns]) s.useFile(null);
});

beforeEach(() => {
    profiles.reset();
    rosterStore.useFile(tempStoreFile(`pr-rosters-${Math.random().toString(36).slice(2)}.json`));
    lootStore.useFile(tempStoreFile(`pr-loot-${Math.random().toString(36).slice(2)}.json`));
    dungeonRuns.update(() => ({ runs: [], characters: [] }));
    profiles.addCharacter(ME, { name: "Borka", className: "Druid", source: "log", versionId: "tbc" });
    profiles.addCharacter(ME, { name: "Devi Res", className: "Mage", source: "log", versionId: "forever", realm: "Forever" });
    profiles.addCharacter(ME, { name: "Devi Rew", className: "Druid", source: "log", versionId: "forever" });
});

describe("profileRaiding", () => {
    it("answers only the characters of the version asked for, by key", () => {
        expect(Object.keys(profileRaiding(ME, "forever").characters)).toEqual(["forever~devi res", "forever~devi rew"]);
        expect(Object.keys(profileRaiding(ME, "tbc").characters)).toEqual(["borka"]);
        expect(profileRaiding(ME, "classic")).toEqual({ versionId: "classic", dungeonTimes: false, rosters: [], characters: {} });
    });

    it("lists the own memberships of the version's open rosters, never another raider's or a closed one", () => {
        const fr = rosterStore.createRoster({ name: "Forever Donnerstag", categoryId: "cat1", versionId: "forever" });
        rosterStore.upsertMember(fr.id, ME, { status: "trial", chars: ["Devi Res"], trialUntil: "2026-10-30T00:00:00.000Z" });
        rosterStore.upsertMember(fr.id, OTHER, { status: "core", chars: ["Somebody"] });
        const tbc = rosterStore.createRoster({ name: "SSC Mittwoch", categoryId: "cat2", versionId: "tbc" });
        rosterStore.upsertMember(tbc.id, ME, { status: "core", chars: ["Borka"] });
        const old = rosterStore.createRoster({ name: "Alt", categoryId: "cat3", versionId: "forever" });
        rosterStore.upsertMember(old.id, ME, { status: "core", chars: ["Devi Rew"] });
        rosterStore.closeRoster(old.id, { reason: "version_switch" });

        const { rosters } = profileRaiding(ME, "forever");
        expect(rosters).toEqual([expect.objectContaining({
            id: fr.id, name: "Forever Donnerstag", categoryId: "cat1", status: "trial",
            chars: ["forever~devi res"], trialUntil: "2026-10-30T00:00:00.000Z",
        })]);
        expect(JSON.stringify(rosters)).not.toContain(OTHER);
        expect(profileRaiding(ME, "tbc").rosters.map((r) => r.name)).toEqual(["SSC Mittwoch"]);
    });

    it("counts a character's loot of its version only and lists the newest few", () => {
        lootStore.addImport("ev_forever", loot("Devi Res", LOOT_SHOWN + 2, "f"), { eventLabel: "Forever Do" });
        // the same name in a TBC raid is another character
        lootStore.addImport("ev_tbc", loot("Devi Res", 3, "t"), { eventLabel: "SSC" });
        const { loot: got } = profileRaiding(ME, "forever").characters["forever~devi res"];
        expect(got.count).toBe(LOOT_SHOWN + 2);
        expect(got.items).toHaveLength(LOOT_SHOWN);
        expect(got.items[0]).toMatchObject({ itemName: `Item ${LOOT_SHOWN + 1}`, eventLabel: "Forever Do" });
        expect(got.lastAt).toBe(got.items[0].awardedAt);
        expect(profileRaiding(ME, "forever").characters["forever~devi rew"].loot).toEqual({ count: 0, lastAt: 0, items: [] });
    });

    it("gives no dungeon block without LevelHelper data - not under TBC, not for a character the addon never saw", () => {
        dungeonRuns.update(() => ({ runs: [run()], characters: [] }));
        expect(profileRaiding(ME, "tbc").characters.borka.dungeons).toBeNull();
        expect(profileRaiding(ME, "forever").characters["forever~devi rew"].dungeons).toBeNull();
    });

    it("ties the dungeon block to the feature „dungeonTimes“: only Forever has it, and switched off there is none", () => {
        dungeonRuns.update(() => ({ runs: [run(), run({ id: "dr_t", versionId: "tbc", members: [{ guid: "", name: "Borka", class: "DRUID" }] })], characters: [] }));
        // TBC data in the store counts for nothing: TBC's rule set has no dungeon best times
        expect(profileRaiding(ME, "tbc", { config: {} })).toMatchObject({ dungeonTimes: false, characters: { borka: { dungeons: null } } });
        expect(profileRaiding(ME, "forever", { config: {} })).toMatchObject({ dungeonTimes: true, characters: { "forever~devi res": { dungeons: { runs: 1 } } } });
        const off = { versionSettings: { forever: { disabled: ["dungeonTimes"] } } };
        expect(profileRaiding(ME, "forever", { config: off })).toMatchObject({ dungeonTimes: false, characters: { "forever~devi res": { dungeons: null } } });
    });

    it("compares names in any case and with doubled spaces", () => {
        dungeonRuns.update(() => ({ runs: [run({ members: [{ guid: "", name: "devi  RES", class: "MAGE" }] })], characters: [] }));
        expect(profileRaiding(ME, "forever", { config: {} }).characters["forever~devi res"].dungeons).toMatchObject({ runs: 1 });
    });

    it("gives points with their rank, medals and the fastest run per dungeon with its place", () => {
        dungeonRuns.update(() => ({
            runs: [
                run(),
                run({ id: "dr_2", seconds: 1700, medal: "silver", members: [{ guid: "g9", name: "Bob", class: "WARRIOR" }] }),
                run({ id: "dr_3", seconds: 2100, medal: "bronze", start: 1791800000, at: 1791802000 }),
                run({ id: "dr_4", dungeon: "Wailing Caverns", seconds: 1500, medal: "gold" }),
            ],
            characters: [
                { key: "forever:g:g1", versionId: "forever", guid: "g1", name: "Devi Res", realm: "Forever", class: "MAGE", points: 340, at: 1791702000 },
                { key: "forever:g:g9", versionId: "forever", guid: "g9", name: "Bob", realm: "Forever", class: "WARRIOR", points: 500, at: 1791702000 },
            ],
        }));
        const d = profileRaiding(ME, "forever").characters["forever~devi res"].dungeons;
        expect(d).toMatchObject({ points: 340, pointsRank: 2, characters: 2, medals: { gold: 2, silver: 0, bronze: 1 }, runs: 3, dungeons: 2 });
        expect(d.best).toEqual([
            expect.objectContaining({ dungeon: "Wailing Caverns", seconds: 1500, place: 1, runsOfDungeon: 1, others: 1 }),
            expect.objectContaining({ dungeon: "The Deadmines", seconds: 1800, medal: "gold", place: 2, runsOfDungeon: 3 }),
        ]);
    });
});

describe("dungeon runs: who counts, which place", () => {
    const devi = { key: "forever:g:g1", versionId: "forever", guid: "g1", name: "Devi Res", realm: "Forever", class: "MAGE", points: 10, at: 1 };

    it("does not count a run of somebody else with the same name but another guid", () => {
        dungeonRuns.update(() => ({
            runs: [run(), run({ id: "dr_2", members: [{ guid: "g7", name: "Devi Res", class: "MAGE" }] })],
            characters: [devi],
        }));
        const d = profileRaiding(ME, "forever").characters["forever~devi res"].dungeons;
        expect(d.runs).toBe(1);
        expect(d.medals.gold).toBe(1);
    });

    it("ranks a tie like the dungeon page: the same time, the earlier start first", () => {
        dungeonRuns.update(() => ({
            runs: [
                run({ id: "dr_a", seconds: 1800, start: 1791600000, members: [{ guid: "g9", name: "Bob", class: "WARRIOR" }] }),
                run({ id: "dr_b", seconds: 1800, start: 1791700000 }),
            ],
            characters: [devi],
        }));
        const [best] = profileRaiding(ME, "forever").characters["forever~devi res"].dungeons.best;
        expect(best).toMatchObject({ dungeon: "The Deadmines", place: 2, runsOfDungeon: 2 });
    });
});

describe("storedCharacterOf", () => {
    const stored = [{ key: "a", name: "Devi Res", realm: "Forever" }, { key: "b", name: "Devi Res", realm: "Other" }];
    it("matches name and realm, a missing realm on either side matches any", () => {
        expect(storedCharacterOf({ name: "devi res", realm: "Other" }, stored).key).toBe("b");
        expect(storedCharacterOf({ name: "Devi Res", realm: "" }, stored).key).toBe("a");
        expect(storedCharacterOf({ name: "Devi Rew", realm: "" }, stored)).toBeNull();
    });
});

// Only the loot of the active Discord server (#919).
describe("profileRaiding per server", () => {
    it("counts only the loot of the active server's raids", () => {
        lootStore.addImport("manual-b", [{
            source: "manual", rawId: "x1", character: "Borka", characterKey: "borka", itemId: 1,
            itemName: "Fremd", awardedAt: 1000,
        }], { eventLabel: "Raid B", guildId: "gB" });
        expect(profileRaiding(ME, "tbc", { guildId: "gA" }).characters.borka.loot.count).toBe(0);
        expect(profileRaiding(ME, "tbc", { guildId: "gB" }).characters.borka.loot.count).toBe(1);
    });
});

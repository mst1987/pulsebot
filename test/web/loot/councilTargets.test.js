// The head of the council page (#676): the roster picker (Loot-Council rosters
// first, categories without roster as fallback), the roster with its profile and
// linked Kader, and the links the caller may follow. Nothing of the Kader but
// its name crosses, and that only for a reader of `kader`.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/services/roster/rosterCreate", () => ({ kaderChoices: jest.fn(() => [{ id: "k1", name: "Forever-Kader" }]) }));
jest.mock("../../../src/services/discord/discord", () => ({
    listCategories: () => [{ id: "cA", name: "Mittwoch" }, { id: "cB", name: "Sonntag" }, { id: "cC", name: "Montag" }],
}));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => ({ categoryIds: ["cA", "cB", "cC"] }) }));

const fs = require("fs");
const rosterStore = require("../../../src/stores/rosterStore");
const profilesStore = require("../../../src/stores/councilProfilesStore");
const { kaderChoices } = require("../../../src/services/roster/rosterCreate");
const eventStore = require("../../../src/stores/eventStore");
const { councilHead, councilRosters, councilCategories, councilOverview } = require("../../../src/web/loot/councilTargets");

const CONFIG = { categoryIds: ["cA", "cB", "cC"], categoryLootSystem: { cA: "lootcouncil", cB: "softres", cC: "lootcouncil" } };
const ADMIN = { id: "1", isAdmin: true };
const COUNCIL = { id: "2", isAdmin: false, access: { lootcouncil: { read: true, write: false } } };

let mi;
let solo;
let main;
beforeEach(() => {
    fs.__store.clear();
    jest.clearAllMocks();
    main = profilesStore.createProfile({ name: "Main T6" });
    mi = rosterStore.createRoster({ name: "Mi-Roster", guildId: "g1", categoryId: "cA", kaderId: "k1", lootProfileId: main.id });
    rosterStore.createRoster({ name: "So-Roster", guildId: "g1", categoryId: "cB" });
    solo = rosterStore.createRoster({ name: "PuG", guildId: "g1", lootSystem: "lootcouncil" });
});

describe("web/loot/councilTargets", () => {
    it("lists the Loot-Council rosters and the categories without roster", () => {
        expect(councilRosters("g1", CONFIG).map((r) => r.name)).toEqual(["Mi-Roster", "PuG"]);
        const head = councilHead({ guildId: "g1", user: ADMIN, opts: {}, config: CONFIG });
        expect(head.target).toBe("all");
        expect(head.roster).toBeNull();
        expect(head.profile).toMatchObject({ id: "standard", isDefault: true, source: "default" });
        expect(head.rosters).toEqual([
            { id: mi.id, name: "Mi-Roster", categoryId: "cA", categoryName: "Mittwoch", profileId: main.id, profileName: "Main T6" },
            { id: solo.id, name: "PuG", categoryId: "", categoryName: "", profileId: "standard", profileName: "Standard" },
        ]);
        expect(head.categories).toEqual([{ id: "cC", name: "Montag", profileId: "standard", profileName: "Standard" }]);
    });

    it("offers no category without roster that runs on another loot system - but keeps one picked through a link", () => {
        const softres = { ...CONFIG, categoryLootSystem: { cA: "lootcouncil", cB: "softres", cC: "softres" } };
        expect(councilCategories("g1", softres)).toEqual([]);
        expect(councilHead({ guildId: "g1", user: ADMIN, opts: {}, config: softres }).categories).toEqual([]);
        const linked = councilHead({ guildId: "g1", user: ADMIN, opts: { categoryId: "cC" }, config: softres });
        expect(linked.categories.map((c) => c.id)).toEqual(["cC"]);
        // the RCLootcouncil addon means Loot-Council while nobody picked a system
        expect(councilCategories("g1", { categoryIds: ["cC"], categoryLootTool: { cC: "rclc" } }).map((c) => c.id)).toEqual(["cC"]);
    });

    describe("councilOverview: the page's tiles", () => {
        const NOW = Date.UTC(2026, 9, 13, 12);
        const at = (days) => Math.floor(NOW / 1000) + days * 86400;

        it("gives a tile per Loot-Council roster and per Loot-Council category without roster - rosters first, by name", () => {
            rosterStore.upsertMember(mi.id, "u1", { status: "core" });
            rosterStore.upsertMember(mi.id, "u2", { status: "trial" });
            rosterStore.upsertMember(mi.id, "u3", { status: "bench" });
            eventStore.createEvent({ guildId: "g1", categoryId: "cA", channelId: "c", title: "Später", startTime: at(9) });
            eventStore.createEvent({ guildId: "g1", categoryId: "cA", channelId: "c", title: "Mittwoch", startTime: at(2) });
            eventStore.createEvent({ guildId: "g1", categoryId: "cA", channelId: "c", title: "Gestern", startTime: at(-1) });
            const { tiles } = councilOverview({ guildId: "g1", config: CONFIG, now: NOW });
            expect(tiles.map((t) => `${t.kind}:${t.name}`)).toEqual(["roster:Mi-Roster", "roster:PuG", "category:Montag"]);
            expect(tiles[0]).toMatchObject({
                id: mi.id, categoryId: "cA", categoryName: "Mittwoch", versionId: "tbc", profileName: "Main T6",
                members: { roster: 2, bench: 1, pause: 0 }, nextRaid: { title: "Mittwoch", startTime: at(2) },
            });
            expect(tiles[0].versionLabel).toBeTruthy();
            // a roster without category has no raid to name
            expect(tiles[1]).toMatchObject({ categoryId: "", categoryName: "", nextRaid: null, members: { roster: 0, bench: 0, pause: 0 } });
            expect(tiles[2]).toMatchObject({ id: "cC", categoryName: "Montag", members: null, nextRaid: null });
        });

        it("skips a cancelled raid and shows nothing on Softres", () => {
            const cancelled = eventStore.createEvent({ guildId: "g1", categoryId: "cC", channelId: "c", title: "Abgesagt", startTime: at(1) }).event;
            eventStore.setEventState(cancelled.id, { status: "cancelled" });
            const { tiles } = councilOverview({ guildId: "g1", config: CONFIG, now: NOW });
            expect(tiles.find((t) => t.id === "cC").nextRaid).toBeNull();
            expect(tiles.map((t) => t.name)).not.toContain("So-Roster");
        });
    });

    it("names the roster, its profile and the linked Kader for a full admin", () => {
        const head = councilHead({ guildId: "g1", user: ADMIN, opts: { rosterId: mi.id, categoryId: "cA" }, config: CONFIG });
        expect(head.target).toBe("roster");
        expect(head.roster).toEqual({
            id: mi.id, name: "Mi-Roster", categoryId: "cA", categoryName: "Mittwoch", versionId: "tbc",
            lootSystem: "lootcouncil", kaderId: "k1", kaderName: "Forever-Kader",
        });
        expect(head.profile).toEqual({ id: main.id, name: "Main T6", isDefault: false, source: "roster" });
        expect(head).toMatchObject({ canOpenRoster: true, canOpenKader: true, canEditProfile: true });
    });

    it("keeps the Kader's name from a council reader without the Kaderplaner", () => {
        const head = councilHead({ guildId: "g1", user: COUNCIL, opts: { rosterId: mi.id }, config: CONFIG });
        expect(head.roster).toMatchObject({ kaderId: "k1", kaderName: "" });
        expect(head).toMatchObject({ canOpenRoster: false, canOpenKader: false, canEditProfile: false });
        expect(kaderChoices).not.toHaveBeenCalled();
    });

    it("keeps a roster picked through a link in the list even on another loot system, and knows a category target", () => {
        const so = rosterStore.listRosters("g1").find((r) => r.name === "So-Roster");
        const head = councilHead({ guildId: "g1", user: ADMIN, opts: { rosterId: so.id }, config: CONFIG });
        expect(head.rosters.map((r) => r.name)).toContain("So-Roster");
        expect(head.roster.lootSystem).toBe("softres");
        expect(councilHead({ guildId: "g1", user: ADMIN, opts: { categoryId: "cC" }, config: CONFIG }).target).toBe("category");
    });

    // The picker offers only what plays the page's version (#741/#563): no TBC
    // roster or category in the Forever council, and the other way round.
    describe("with the page's version", () => {
        const VERSIONED = {
            categoryIds: ["cA", "cB", "cC", "cD"], categoryLootSystem: { cA: "lootcouncil", cB: "softres", cC: "lootcouncil", cD: "lootcouncil" },
            mainVersion: "forever", categoryVersion: { cA: "tbc", cB: "tbc", cC: "forever", cD: "forever" },
        };
        let fo;
        beforeEach(() => {
            fo = rosterStore.createRoster({ name: "Fo-Roster", guildId: "g1", categoryId: "cC", versionId: "forever", lootSystem: "lootcouncil" });
        });

        it("lists only the Forever rosters and categories in the Forever council", () => {
            const head = councilHead({ guildId: "g1", user: ADMIN, opts: { charVersion: "forever" }, config: VERSIONED });
            expect(head.rosters.map((r) => r.name)).toEqual(["Fo-Roster"]);
            expect(head.rosters[0]).toMatchObject({ id: fo.id, categoryName: "Montag" });
            expect(head.categories.map((c) => c.id)).toEqual(["cD"]);
            expect(head.dropped).toBeNull();
        });

        it("lists only the TBC ones in the TBC council", () => {
            const head = councilHead({ guildId: "g1", user: ADMIN, opts: { charVersion: "tbc" }, config: VERSIONED });
            expect(head.rosters.map((r) => r.name)).toEqual(["Mi-Roster", "PuG"]);
            expect(head.categories).toEqual([]);
        });

        it("filters councilRosters by version and passes a dropped pick on", () => {
            expect(councilRosters("g1", VERSIONED, { versionId: "forever" }).map((r) => r.name)).toEqual(["Fo-Roster"]);
            const dropped = { kind: "roster", id: mi.id, versionId: "tbc" };
            const head = councilHead({ guildId: "g1", user: ADMIN, opts: { charVersion: "forever", droppedPick: dropped }, config: VERSIONED });
            expect(head.dropped).toEqual(dropped);
            expect(head.target).toBe("all");
            expect(head.rosters.map((r) => r.id)).not.toContain(mi.id);
        });
    });
});

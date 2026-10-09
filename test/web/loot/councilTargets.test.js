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
const { councilHead, councilRosters } = require("../../../src/web/loot/councilTargets");

const CONFIG = { categoryIds: ["cA", "cB", "cC"], categoryLootSystem: { cA: "lootcouncil", cB: "softres" } };
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
});

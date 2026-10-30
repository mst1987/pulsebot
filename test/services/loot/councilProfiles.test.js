// Which Loot-Council profile applies (#676): the roster's own, else the
// category's, else the default - and who uses which profile.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const rosterStore = require("../../../src/stores/roster/rosterStore");
const profilesStore = require("../../../src/stores/loot/councilProfilesStore");
const {
    resolveProfile, profileHead, weightsFor, viewFor, profileInUse, profileUsage, profileShownIn, rosterOfTarget,
} = require("../../../src/services/loot/councilProfiles");

const CONFIG = { categoryLootSystem: { cA: "lootcouncil", cB: "softres" } };

let main;
let pug;
beforeEach(() => {
    fs.__store.clear();
    main = profilesStore.createProfile({ name: "Main T6" });
    profilesStore.updateProfile(main.id, { weights: { tenureDays: 30, classes: { trinket: 4 } }, view: { role: "healer", tiers: ["t6"] } });
    pug = profilesStore.createProfile({ name: "PuG" });
});

describe("services/loot/councilProfiles resolveProfile", () => {
    it("takes the roster's own profile first", () => {
        const r = rosterStore.createRoster({ name: "Mi", guildId: "g1", categoryId: "cA", lootProfileId: main.id });
        profilesStore.setCategoryProfile("cA", pug.id);
        expect(resolveProfile({ rosterId: r.id })).toMatchObject({ source: "roster", categoryId: "cA", profile: { id: main.id } });
        expect(resolveProfile({ categoryId: "cA" })).toMatchObject({ source: "roster", profile: { id: main.id } });
        expect(rosterOfTarget({ categoryId: "cA" }).id).toBe(r.id);
    });

    it("falls back to the category's profile, then to the default", () => {
        const r = rosterStore.createRoster({ name: "Mi", guildId: "g1", categoryId: "cA", lootProfileId: "p-gone" });
        profilesStore.setCategoryProfile("cA", pug.id);
        expect(resolveProfile({ rosterId: r.id })).toMatchObject({ source: "category", profile: { id: pug.id } });
        profilesStore.setCategoryProfile("cA", "");
        expect(resolveProfile({ rosterId: r.id })).toMatchObject({ source: "default", profile: { id: "standard" } });
        // a category without roster
        profilesStore.setCategoryProfile("cX", main.id);
        expect(resolveProfile({ categoryId: "cX" })).toMatchObject({ source: "category", roster: null, profile: { id: main.id } });
        expect(resolveProfile({})).toMatchObject({ source: "default", categoryId: "" });
        expect(resolveProfile({ rosterId: "nope" })).toMatchObject({ source: "default", roster: null });
    });

    it("never reads a category entry for a roster without category", () => {
        const solo = rosterStore.createRoster({ name: "PuG", guildId: "g1" });
        expect(resolveProfile({ rosterId: solo.id, categoryId: "cX" })).toMatchObject({ source: "default", categoryId: "" });
    });
});

describe("services/loot/councilProfiles weightsFor / viewFor / profileHead", () => {
    it("hands out the profile's weighting with scope and name", () => {
        const r = rosterStore.createRoster({ name: "Mi", guildId: "g1", lootProfileId: main.id });
        expect(weightsFor({ rosterId: r.id })).toMatchObject({ scope: "profile", profileId: main.id, profileName: "Main T6", tenureDays: 30, classes: { trinket: 4 } });
        expect(weightsFor({})).toMatchObject({ scope: "global", profileId: "standard", tenureDays: 90 });
        expect(viewFor({ rosterId: r.id })).toEqual({ role: "healer", tiers: ["t6"], contents: [], bisTier: "", version: "", stored: true, profileId: main.id });
        expect(profileHead(main, "roster")).toEqual({ id: main.id, name: "Main T6", isDefault: false, source: "roster" });
        expect(profileHead(profilesStore.defaultProfile())).toEqual({ id: "standard", name: "Standard", isDefault: true });
    });
});

describe("services/loot/councilProfiles usage", () => {
    it("counts the Loot-Council rosters per profile, keeps the others apart and knows what is in use", () => {
        rosterStore.createRoster({ name: "Mittwoch", guildId: "g1", categoryId: "cA", lootProfileId: main.id });
        rosterStore.createRoster({ name: "Sonntag", guildId: "g1", categoryId: "cB", lootProfileId: pug.id });
        rosterStore.createRoster({ name: "Ohne", guildId: "g1", lootSystem: "lootcouncil" });
        profilesStore.setCategoryProfile("cZ", pug.id);
        const usage = profileUsage({ config: CONFIG, guildId: "g1" });
        expect(usage.get(main.id).rosters.map((r) => r.name)).toEqual(["Mittwoch"]);
        expect(usage.get("standard").rosters.map((r) => r.name)).toEqual(["Ohne"]);
        expect(usage.get(pug.id)).toMatchObject({ rosters: [], otherRosters: [{ name: "Sonntag" }], categories: ["cZ"] });
        expect(profileInUse(main.id)).toBe(true);
        expect(profileInUse(pug.id)).toBe(true);
        const free = profilesStore.createProfile({ name: "Frei" });
        expect(profileInUse(free.id)).toBe(false);
        expect(profileInUse("")).toBe(false);
    });
});

// The profile tab shows one version (#741/#563): usage and list per version.
describe("services/loot/councilProfiles per version", () => {
    const VERSIONED = {
        categoryLootSystem: { cA: "lootcouncil", cF: "lootcouncil" },
        mainVersion: "forever", categoryVersion: { cA: "tbc", cF: "forever", cG: "forever", cT: "tbc" },
    };
    let tbcOnly;
    let foreverOnly;
    beforeEach(() => {
        tbcOnly = profilesStore.createProfile({ name: "TBC Montag" });
        foreverOnly = profilesStore.createProfile({ name: "Forever Mittwoch" });
        rosterStore.createRoster({ name: "Montagsraid", guildId: "g1", categoryId: "cA", versionId: "tbc", lootProfileId: tbcOnly.id });
        rosterStore.createRoster({ name: "Forever", guildId: "g1", categoryId: "cF", versionId: "forever", lootProfileId: foreverOnly.id });
        profilesStore.setCategoryProfile("cT", tbcOnly.id);
        profilesStore.setCategoryProfile("cG", foreverOnly.id);
    });

    it("names only rosters and categories of the version", () => {
        const forever = profileUsage({ config: VERSIONED, guildId: "g1", versionId: "forever" });
        expect(forever.get(foreverOnly.id)).toMatchObject({ rosters: [{ name: "Forever" }], categories: ["cG"] });
        expect(forever.get(tbcOnly.id)).toBeUndefined();
        const tbc = profileUsage({ config: VERSIONED, guildId: "g1", versionId: "tbc" });
        expect(tbc.get(tbcOnly.id)).toMatchObject({ rosters: [{ name: "Montagsraid" }], categories: ["cT"] });
        expect(tbc.get(foreverOnly.id)).toBeUndefined();
        // without a version: every one, as before
        const all = profileUsage({ config: VERSIONED, guildId: "g1" });
        expect(all.get(tbcOnly.id).rosters).toHaveLength(1);
        expect(all.get(foreverOnly.id).rosters).toHaveLength(1);
    });

    it("lists the default, the version's own and unused profiles - not another version's", () => {
        const allUsage = profileUsage({ config: VERSIONED, guildId: "g1" });
        const shown = (versionId) => profilesStore.listProfiles()
            .filter((p) => profileShownIn(p, versionId, { usage: profileUsage({ config: VERSIONED, guildId: "g1", versionId }), allUsage }))
            .map((p) => p.name);
        // "Main T6" and "PuG" of the outer beforeEach are used by nobody: they belong to no version yet
        expect(shown("forever")).toEqual(expect.arrayContaining(["Standard", "Forever Mittwoch", "Main T6", "PuG"]));
        expect(shown("forever")).not.toContain("TBC Montag");
        expect(shown("tbc")).toEqual(expect.arrayContaining(["Standard", "TBC Montag"]));
        expect(shown("tbc")).not.toContain("Forever Mittwoch");
        expect(profileShownIn(tbcOnly, "", { usage: new Map(), allUsage })).toBe(true);
    });
});

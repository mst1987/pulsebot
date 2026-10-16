// What a game version can do and what it does (#761): the one source, the
// matrix of Einstellungen → Spielversion, and the readers that ask it.
const { tempStoreFile } = require("../../helpers/tempStore");
const catalogStore = require("../../../src/stores/raidplanCatalogStore");
const caps = require("../../../src/services/events/versionCapabilities");
const logVersion = require("../../../src/services/logcheck/logVersion");
const { versionLinks, blizzardFor } = require("../../../src/services/events/versionSettings");
const { VERSION_FEATURES } = require("../../../src/config/versionFeatures");

// Everything TBC needs for every feature, Classic with its standard values, Forever with its Wowhead path only.
const TBC = {
    blizzardRegion: "eu", blizzardRealmSlug: "thunderstrike", blizzardNamespace: "profile-classicann-eu",
    armoryUrlTemplate: "https://classic-armory.org/character/{region}/tbc-anniversary/{realm}/{char}",
    wclUrlTemplate: "https://fresh.warcraftlogs.com/character/{region}/{realm}/{char}",
    wowheadPath: "tbc", softresEdition: "tbc",
};
const config = (tbc = {}, forever = {}) => ({
    mainVersion: "tbc",
    versionSettings: {
        tbc: { ...TBC, ...tbc },
        classic: { wowheadPath: "classic", softresEdition: "classic" },
        forever: { wowheadPath: "forever", ...forever },
    },
});
const OFF = config({ disabled: [...VERSION_FEATURES] });

beforeAll(() => catalogStore.useFile(tempStoreFile("raidplan-catalog.json")));
afterAll(() => catalogStore.useFile(null));

const states = (versionId, cfg) => Object.fromEntries(
    Object.entries(caps.versionCapabilities(versionId, { config: cfg })).map(([f, s]) => [f, s.on ? "an" : s.possible ? "aus" : `nicht möglich (${s.reason})`]),
);

describe("services/events/versionCapabilities — the matrix", () => {
    it("has TBC do everything but the dungeon best times (no LevelHelper on its client)", () => {
        expect(states("tbc", config())).toEqual({
            ...Object.fromEntries(VERSION_FEATURES.map((f) => [f, "an"])),
            dungeonTimes: "nicht möglich (no_dungeon_times)",
        });
    });

    it("has Forever do only the BiS hand lists, the Wowhead links and the dungeon best times today, each other feature with its reason", () => {
        expect(states("forever", config())).toEqual({
            logcheck: "nicht möglich (rules_not_ready)",
            // no BiS data of its own: the orga's hand lists (#760)
            lootCouncilBis: "an",
            simulation: "nicht möglich (no_sim_data)",
            raidSheet: "nicht möglich (no_sheet_layout)",
            softres: "nicht möglich (no_softres_edition)",
            armory: "nicht möglich (armory_not_configured)",
            wowheadLinks: "an",
            raidplanCatalog: "nicht möglich (no_catalog_entries)",
            dungeonTimes: "an",
        });
        const logcheck = caps.featureState("forever", "logcheck", { config: config() });
        expect(logcheck.message).toBe("Die Logcheck-Regeln für WoW Forever sind noch nicht fertig.");
        expect(logcheck.missing.length).toBeGreaterThan(0);
        expect(caps.featureState("forever", "lootCouncilBis", { config: config({}, { disabled: ["lootCouncilBis"] }) }))
            .toMatchObject({ possible: true, on: false, reason: "disabled" });
    });

    it("has Classic without log rules, but softres and Wowhead from its settings", () => {
        const s = states("classic", config());
        expect(s.logcheck).toBe("nicht möglich (no_rules)");
        expect(s.softres).toBe("an");
        expect(s.wowheadLinks).toBe("an");
        expect(s.armory).toBe("nicht möglich (armory_not_configured)");
    });

    it("makes a feature possible from data, not code: a Forever entry in the catalog, a Forever softres edition", () => {
        catalogStore.save("spells", { name: "Fluch", type: "curse", classes: ["warlock"], versions: ["forever"] });
        const cfg = config({}, { softresEdition: "classic" });
        expect(caps.featureOn("forever", "raidplanCatalog", { config: cfg })).toBe(true);
        expect(caps.featureOn("forever", "softres", { config: cfg })).toBe(true);
        catalogStore.useFile(tempStoreFile("raidplan-catalog-2.json"));
    });

    it("turns a switched-off feature into one that is off with its own hint", () => {
        // every feature TBC can have (the dungeon best times are Forever's, see below)
        for (const f of VERSION_FEATURES.filter((x) => x !== "dungeonTimes")) {
            const s = caps.featureState("tbc", f, { config: OFF });
            expect(s).toMatchObject({ possible: true, enabled: false, on: false, reason: "disabled" });
            expect(s.message).toMatch(/ist für TBC Anniversary ausgeschaltet \(Einstellungen → Spielversion\)\.$/);
        }
        expect(caps.featureState("forever", "dungeonTimes", { config: config({}, { disabled: ["dungeonTimes"] }) }))
            .toMatchObject({ possible: true, enabled: false, on: false, reason: "disabled" });
        // a feature that is not possible keeps its own reason, switched off or not
        const off = caps.featureState("forever", "raidSheet", { config: config({}, { disabled: ["raidSheet"] }) });
        expect(off).toMatchObject({ possible: false, enabled: false, reason: "no_sheet_layout" });
    });

    it("answers an unknown version or feature with nothing possible", () => {
        expect(caps.featureState("wotlk", "logcheck", { config: config() })).toMatchObject({ on: false, reason: "unknown_version" });
        expect(caps.featureState("tbc", "teleport", { config: config() })).toMatchObject({ on: false, reason: "unknown_feature" });
        expect(caps.featureOn("", "wowheadLinks", { config: config() })).toBe(false);
    });

    it("builds the settings matrix for every version", () => {
        const m = caps.capabilityMatrix({ config: config() });
        expect(m.features).toEqual([...VERSION_FEATURES]);
        expect(Object.keys(m.versions)).toEqual(["tbc", "classic", "forever"]);
        expect(m.versions.tbc.logcheck).toEqual({ possible: true, enabled: true, on: true, reason: "", message: "", missing: [], also: [] });
        expect(m.versions.forever.logcheck).toMatchObject({ reason: "rules_not_ready", also: ["no_site"] });
        expect(Object.keys(m.versions.forever)).toEqual([...VERSION_FEATURES]);
    });

    it("reads the stored config when none is handed in", () => {
        expect(caps.versionCapabilities("tbc").wowheadLinks).toMatchObject({ possible: true });
    });
});

describe("services/events/versionCapabilities — the readers", () => {
    it("log check: TBC asks the classic host; switched off it is refused with the hint", () => {
        expect(caps.wclApiSite("tbc", { config: config() })).toBe("https://classic.warcraftlogs.com");
        expect(logVersion.wclApiSite("tbc", { config: config() })).toBe("https://classic.warcraftlogs.com");
        expect(caps.wclApiSite("forever", { config: config({}, { wclUrlTemplate: "https://forever.warcraftlogs.com/character/{char}" }) })).toBe("https://forever.warcraftlogs.com");
        expect(logVersion.logcheckSupported("tbc", { config: config() })).toBe(true);
        expect(logVersion.logcheckSupported("tbc", { config: OFF })).toBe(false);
        expect(logVersion.unsupportedMessage("tbc", { config: OFF })).toBe("Logcheck ist für TBC Anniversary ausgeschaltet (Einstellungen → Spielversion).");
        expect(logVersion.unsupportedMessage("forever", { config: config() })).toBe("Logs von WoW Forever werden noch nicht ausgewertet.");
    });

    it("loot council: TBC has everything, switched off nothing and says so, Forever only the hand lists", () => {
        expect(caps.councilContent("tbc", { config: config() })).toEqual({ bis: true, manualBis: false, sim: true, tiers: true, itemTable: true, off: false, simHint: "" });
        const off = caps.councilContent("tbc", { config: OFF });
        expect(off).toMatchObject({ bis: false, manualBis: false, sim: false, tiers: false, itemTable: false, off: true });
        expect(off.simHint).toBe("Simulation ist für TBC Anniversary ausgeschaltet (Einstellungen → Spielversion).");
        const simOnly = caps.councilContent("tbc", { config: config({ disabled: ["simulation"] }) });
        expect(simOnly).toMatchObject({ bis: true, itemTable: true, sim: false, off: false });
        expect(caps.councilContent("forever", { config: config() })).toEqual({
            bis: false, manualBis: true, sim: false, tiers: false, itemTable: false, off: false, simHint: "Für diese Spielversion gibt es keine Simulation.",
        });
        // switched off: no hand lists either, and the page says "ausgeschaltet" (#760)
        expect(caps.councilContent("forever", { config: config({}, { disabled: ["lootCouncilBis"] }) }))
            .toMatchObject({ bis: false, manualBis: false, off: true });
        expect(caps.councilContent("", { config: config() })).toMatchObject({ bis: false, manualBis: false, sim: false });
    });

    it("raid sheet: TBC fills it, Forever is refused naming the version, switched off says so", () => {
        expect(caps.sheetOffered("tbc", { config: config() })).toBe(true);
        expect(caps.sheetVersionRefusal("tbc", { config: config() })).toBeNull();
        expect(caps.sheetVersionRefusal("forever", { config: config() })).toEqual({ status: 409, code: "no_sheet_layout", message: expect.stringContaining("WoW Forever") });
        expect(caps.sheetVersionRefusal("classic", { config: config() })).toMatchObject({ status: 409, code: "no_sheet_layout" });
        expect(caps.sheetOffered("tbc", { config: OFF })).toBe(false);
        expect(caps.sheetVersionRefusal("tbc", { config: OFF })).toEqual({
            status: 409, code: "feature_off", message: "Raidsheet ist für TBC Anniversary ausgeschaltet (Einstellungen → Spielversion). Plane diesen Raid mit dem Raidplan.",
        });
    });

    it("Wowhead links: built while on, none while off", () => {
        expect(versionLinks("tbc", { config: config() }).wowheadItem(30000)).toBe("https://www.wowhead.com/tbc/item=30000");
        expect(versionLinks("tbc", { config: config() }).wowheadPath).toBe("tbc");
        const off = versionLinks("tbc", { config: OFF });
        expect(off.wowheadItem(30000)).toBe("");
        expect(off.wowheadSpell(100)).toBe("");
        expect(off.wowheadPath).toBe("");
        expect(versionLinks("forever", { config: config() }).wowheadItem(5)).toBe("https://www.wowhead.com/forever/item=5");
    });

    it("armory: switched off it asks nobody and says why", () => {
        const bz = blizzardFor("tbc", { config: { ...OFF, blizzard: { clientId: "id", clientSecret: "secret" } } });
        expect(bz).toMatchObject({ client: null, reason: "feature_off", message: "Armory-Abruf ist für TBC Anniversary ausgeschaltet (Einstellungen → Spielversion)." });
        expect(blizzardFor("forever", { config: config() })).toMatchObject({ client: null, reason: "version_not_configured" });
    });

    it("raid plan catalog: on for TBC and for a plan without a known version, off when switched off", () => {
        expect(caps.catalogEnabled("tbc", { config: config() })).toBe(true);
        expect(caps.catalogEnabled("tbc", { config: OFF })).toBe(false);
        expect(caps.catalogEnabled("", { config: OFF })).toBe(true);
        expect(caps.catalogEnabled("wotlk", { config: OFF })).toBe(true);
    });
});

// Settings per game version at work (#542): settingsForVersion is the
// interface #543 calls with a character's version, versionLinks builds every
// link (and leaves one out rather than breaking it), blizzardFor hands out a
// client for a version's realm or says why there is none.
jest.mock("../../../src/classes/blizzard", () => jest.fn().mockImplementation((opts) => ({
    opts,
    isConfigured: () => Boolean(opts.clientId && opts.clientSecret),
})));

const Blizzard = require("../../../src/classes/blizzard");
const { normalizeVersionSettings } = require("../../../src/stores/versionSettingsSchema");
const vs = require("../../../src/services/events/versionSettings");

const TBC = {
    blizzardRegion: "eu", blizzardRealmSlug: "thunderstrike", blizzardNamespace: "profile-classicann-eu",
    armoryUrlTemplate: "https://classic-armory.org/character/eu/tbc-anniversary/thunderstrike/{char}",
    wclUrlTemplate: "https://fresh.warcraftlogs.com/character/eu/thunderstrike/{char}",
    wowheadPath: "tbc", softresEdition: "tbc", raidsheetId: "tier45",
};
const FOREVER = {
    blizzardRegion: "eu", blizzardRealmSlug: "everlook", blizzardNamespace: "profile-forever-eu",
    armoryUrlTemplate: "https://armory.forever.test/eu/{char}", wclUrlTemplate: "https://forever.warcraftlogs.test/character/eu/everlook/{char}",
    wowheadPath: "forever", softresEdition: "", raidsheetId: "",
};
const config = (over = {}) => ({
    mainVersion: "tbc",
    blizzard: { clientId: "id", clientSecret: "secret" },
    versionSettings: normalizeVersionSettings({ tbc: TBC }),
    ...over,
});

beforeEach(() => Blizzard.mockClear());

describe("services/events/versionSettings", () => {
    describe("settingsForVersion", () => {
        it("reads the block of the version asked for", () => {
            expect(vs.settingsForVersion("tbc", { config: config() })).toEqual({ versionId: "tbc", ...TBC });
            expect(vs.settingsForVersion("forever", { config: config() })).toMatchObject({ versionId: "forever", wowheadPath: "", blizzardRealmSlug: "" });
        });

        it("reads the main version for a missing or unknown id", () => {
            const cfg = config({ mainVersion: "forever", versionSettings: normalizeVersionSettings({ tbc: TBC, forever: FOREVER }) });
            expect(vs.settingsForVersion("", { config: cfg })).toMatchObject({ versionId: "forever", wowheadPath: "forever" });
            expect(vs.settingsForVersion("wotlk", { config: cfg }).versionId).toBe("forever");
        });

        it("reads a config without the map (before the migration) with the old values as TBC", () => {
            const out = vs.settingsForVersion("tbc", { config: { blizzard: { realmSlug: "nightslayer", region: "us" } } });
            expect(out).toMatchObject({ blizzardRealmSlug: "nightslayer", blizzardRegion: "us", wowheadPath: "tbc", softresEdition: "tbc" });
        });

        it("reads the stored config when none is handed in", () => {
            expect(vs.settingsForVersion("tbc")).toMatchObject({ versionId: "tbc", wowheadPath: "tbc" });
        });
    });

    describe("versionLinks", () => {
        it("builds the TBC links exactly as before #542", () => {
            const links = vs.versionLinks("tbc", { config: config() });
            expect(links.armory("Devihra")).toBe("https://classic-armory.org/character/eu/tbc-anniversary/thunderstrike/Devihra");
            expect(links.wcl("Bärli")).toBe("https://fresh.warcraftlogs.com/character/eu/thunderstrike/B%C3%A4rli");
            expect(links.wowheadItem(32837)).toBe("https://www.wowhead.com/tbc/item=32837");
            // an Anniversary re-issue links the original item
            expect(links.wowheadItem(281893)).toBe("https://www.wowhead.com/tbc/item=37128");
            expect(links.wowheadItem(9001, ["ench=1", "gems=2:3"])).toBe("https://www.wowhead.com/tbc/item=9001?ench=1&gems=2:3");
            expect(links.wowheadSpell(25306)).toBe("https://www.wowhead.com/tbc/spell=25306");
            expect(links.softresEdition).toBe("tbc");
            expect(links.raidsheetId).toBe("tier45");
        });

        it("leaves every link out for a version without settings (Forever until known)", () => {
            const links = vs.versionLinks("forever", { config: config() });
            expect(links.armory("Devihra")).toBe("");
            expect(links.wcl("Devihra")).toBe("");
            expect(links.wowheadItem(32837)).toBe("");
            expect(links.wowheadSpell(1)).toBe("");
            expect(links.wowheadPath).toBe("");
            expect(links.softresEdition).toBe("");
        });

        it("uses a version's own values once they are entered", () => {
            const cfg = config({ versionSettings: normalizeVersionSettings({ tbc: TBC, forever: FOREVER }) });
            const links = vs.versionLinks("forever", { config: cfg });
            expect(links.armory("Nera")).toBe("https://armory.forever.test/eu/Nera");
            expect(links.wowheadItem(19019)).toBe("https://www.wowhead.com/forever/item=19019");
        });

        it("gives no link without a name or an id", () => {
            const links = vs.versionLinks("tbc", { config: config() });
            expect(links.armory("  ")).toBe("");
            expect(links.wowheadItem(0)).toBe("");
            expect(links.wowheadItem("x")).toBe("");
        });
    });

    describe("fillChar", () => {
        it("fills every placeholder and passes the result through the link check", () => {
            expect(vs.fillChar("https://x.test/{char}/{char}", "A B")).toBe("https://x.test/A%20B/A%20B");
            expect(vs.fillChar("not a url {char}", "Nera")).toBe("");
            expect(vs.fillChar("", "Nera")).toBe("");
        });
    });

    describe("blizzardFor", () => {
        it("builds a client with the version's region, realm and namespace", () => {
            const cfg = config({ versionSettings: normalizeVersionSettings({ tbc: TBC, forever: FOREVER }) });
            const out = vs.blizzardFor("forever", { config: cfg });
            expect(out.reason).toBe("");
            expect(Blizzard).toHaveBeenCalledWith({
                clientId: "id", clientSecret: "secret", region: "eu", realmSlug: "everlook", namespace: "profile-forever-eu",
            });
            expect(out).toMatchObject({ versionId: "forever", namespace: "profile-forever-eu", realmSlug: "everlook" });
        });

        it("builds no client for a version without a realm, and says which one", () => {
            const out = vs.blizzardFor("forever", { config: config() });
            expect(out.client).toBeNull();
            expect(out.reason).toBe("version_not_configured");
            expect(out.message).toBe("Armory für WoW Forever nicht eingerichtet (Einstellungen → Spielversion).");
            expect(Blizzard).not.toHaveBeenCalled();
        });

        it("builds no client without credentials", () => {
            const out = vs.blizzardFor("tbc", { config: config({ blizzard: {} }) });
            expect(out).toMatchObject({ client: null, reason: "not_configured" });
        });
    });

    it("names a version by its label", () => {
        expect(vs.versionLabel("tbc")).toBe("TBC Anniversary");
        expect(vs.versionLabel("wotlk")).toBe("wotlk");
    });

    describe("{region}/{realm} templates and the log site (#553)", () => {
        const CLASSIC = {
            blizzardRegion: "eu", blizzardRealmSlug: "firemaw", blizzardNamespace: "profile-classic1x-eu",
            armoryUrlTemplate: "https://classic-armory.org/character/{region}/vanilla/{realm}/{char}",
            wclUrlTemplate: "https://vanilla.warcraftlogs.com/character/{region}/{realm}/{char}",
            wowheadPath: "classic", softresEdition: "classic", raidsheetId: "",
        };
        const cfg = (classic) => config({ versionSettings: normalizeVersionSettings({ tbc: TBC, classic }) });

        it("fills region and realm from the version's own fields", () => {
            const links = vs.versionLinks("classic", { config: cfg(CLASSIC) });
            expect(links.armory("Nera")).toBe("https://classic-armory.org/character/eu/vanilla/firemaw/Nera");
            expect(links.wcl("Nera")).toBe("https://vanilla.warcraftlogs.com/character/eu/firemaw/Nera");
        });

        it("leaves the link out while the realm is not set", () => {
            const links = vs.versionLinks("classic", { config: cfg({ ...CLASSIC, blizzardRealmSlug: "" }) });
            expect(links.armory("Nera")).toBe("");
            expect(links.wcl("Nera")).toBe("");
            expect(vs.fillChar("https://x.test/{region}/{char}", "Nera")).toBe("");
            expect(vs.fillChar("https://x.test/{region}/{char}", "Nera", { region: "us" })).toBe("https://x.test/us/Nera");
        });

        it("names the log site and builds report links on it", () => {
            const links = vs.versionLinks("classic", { config: cfg(CLASSIC) });
            expect(links.wclSite).toBe("https://vanilla.warcraftlogs.com");
            expect(links.wclReport("aBc123")).toBe("https://vanilla.warcraftlogs.com/reports/aBc123");
            expect(links.wclReport("../x")).toBe("");
            expect(vs.versionLinks("tbc", { config: cfg(CLASSIC) }).wclReport("r1")).toBe("https://fresh.warcraftlogs.com/reports/r1");
        });

        it("has no log site without a warcraftlogs.com template", () => {
            expect(vs.wclSiteOf("")).toBe("");
            expect(vs.wclSiteOf("https://forever.warcraftlogs.test/character/{char}")).toBe("");
            expect(vs.wclSiteOf("http://fresh.warcraftlogs.com/{char}")).toBe("");
            expect(vs.wclSiteOf("not a url {char}")).toBe("");
            expect(vs.versionLinks("forever", { config: cfg(CLASSIC) }).wclReport("r1")).toBe("");
        });
    });
});

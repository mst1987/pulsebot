// A server's own armory/log templates and realm (#923, epic #926): without an
// override every link stays as today; with one only that one field changes,
// and only for the server that set it.
jest.mock("../../../src/classes/blizzard", () => jest.fn().mockImplementation((opts) => ({
    opts,
    isConfigured: () => Boolean(opts.clientId && opts.clientSecret),
})));

const { normalizeVersionSettings } = require("../../../src/stores/settings/versionSettingsSchema");
const vs = require("../../../src/services/versions/versionSettings");

const G1 = "111111111111111111";
const G2 = "222222222222222222";
const TBC = {
    blizzardRegion: "eu", blizzardRealmSlug: "thunderstrike", blizzardNamespace: "profile-classicann-eu",
    armoryUrlTemplate: "https://armory.test/eu/thunderstrike/{char}",
    wclUrlTemplate: "https://fresh.warcraftlogs.com/character/eu/thunderstrike/{char}",
    wowheadPath: "tbc", softresEdition: "tbc", raidsheetId: "", color: "",
};
const config = (overrides = {}) => ({
    mainVersion: "tbc",
    blizzard: { clientId: "id", clientSecret: "secret" },
    versionSettings: normalizeVersionSettings({ tbc: TBC }),
    serverSettings: { [G1]: { versionOverrides: overrides } },
});

describe("services/versions/versionSettings - per-server overrides (#923)", () => {
    it("builds today's links without a server, for a server without overrides and for another server", () => {
        const plain = vs.versionLinks("tbc", { config: config() });
        for (const guildId of [undefined, "", G1, G2]) {
            const links = vs.versionLinks("tbc", { config: config(), guildId });
            expect(links.armory("Brokk")).toBe(plain.armory("Brokk"));
            expect(links.wcl("Brokk")).toBe(plain.wcl("Brokk"));
        }
        expect(plain.armory("Brokk")).toBe("https://armory.test/eu/thunderstrike/Brokk");
        expect(vs.settingsForVersion("tbc", { config: config(), guildId: G1 })).toEqual({ versionId: "tbc", ...TBC });
    });

    it("changes only the armory link when the server sets its own armory template", () => {
        const cfg = config({ tbc: { armoryUrlTemplate: "https://own-armory.test/{char}" } });
        const own = vs.versionLinks("tbc", { config: cfg, guildId: G1 });
        expect(own.armory("Brokk")).toBe("https://own-armory.test/Brokk");
        expect(own.wcl("Brokk")).toBe("https://fresh.warcraftlogs.com/character/eu/thunderstrike/Brokk");
        expect(own.wowheadItem(28830)).toBe(vs.versionLinks("tbc", { config: cfg }).wowheadItem(28830));
        // another server keeps the standard
        expect(vs.versionLinks("tbc", { config: cfg, guildId: G2 }).armory("Brokk")).toBe("https://armory.test/eu/thunderstrike/Brokk");
    });

    it("changes only the log link when the server sets its own WCL template", () => {
        const cfg = config({ tbc: { wclUrlTemplate: "https://www.warcraftlogs.com/character/eu/other/{char}" } });
        const s = vs.settingsForVersion("tbc", { config: cfg, guildId: G1 });
        expect(s).toEqual({ versionId: "tbc", ...TBC, wclUrlTemplate: "https://www.warcraftlogs.com/character/eu/other/{char}", overridden: ["wclUrlTemplate"] });
        expect(vs.versionLinks("tbc", { config: cfg, guildId: G1 }).armory("Brokk")).toBe("https://armory.test/eu/thunderstrike/Brokk");
    });

    it("hands the server's own realm and region to the Blizzard client, the namespace follows the region", () => {
        const cfg = config({ tbc: { blizzardRealmSlug: "spineshatter", blizzardRegion: "us" } });
        const own = vs.blizzardFor("tbc", { config: cfg, guildId: G1 });
        // an EU namespace on us.api.blizzard.com would be a 404
        expect(own).toMatchObject({ realmSlug: "spineshatter", region: "us", namespace: "profile-classicann-us" });
        expect(vs.blizzardFor("tbc", { config: cfg, guildId: G2 })).toMatchObject({ realmSlug: "thunderstrike", region: "eu", namespace: "profile-classicann-eu" });
        const realmOnly = config({ tbc: { blizzardRealmSlug: "spineshatter" } });
        expect(vs.blizzardFor("tbc", { config: realmOnly, guildId: G1 })).toMatchObject({ region: "eu", namespace: "profile-classicann-eu" });
    });

    it("ignores an invalid stored override instead of breaking the link", () => {
        const cfg = config({ tbc: { armoryUrlTemplate: "https://no-placeholder.test/" } });
        expect(vs.versionLinks("tbc", { config: cfg, guildId: G1 }).armory("Brokk")).toBe("https://armory.test/eu/thunderstrike/Brokk");
        expect(vs.settingsForVersion("tbc", { config: cfg, guildId: G1 }).overridden).toBeUndefined();
    });
});

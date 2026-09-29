// The shape of config.versionSettings (#542): only valid values survive, an
// empty field means "not there for this version", and a config from before
// #542 reads its old single values as the TBC block.
const schema = require("../../src/stores/versionSettingsSchema");
const defaults = require("../../src/config/defaults");

const TBC_ARMORY = "https://classic-armory.org/character/eu/tbc-anniversary/thunderstrike/{char}";

describe("stores/versionSettingsSchema", () => {
    describe("normalizeBlock", () => {
        it("keeps valid values and trims, lower-cases and slugs them", () => {
            expect(schema.normalizeBlock({
                blizzardRegion: " EU ", blizzardRealmSlug: "Die Aldor", blizzardNamespace: "Profile-Classic1x-EU",
                armoryUrlTemplate: TBC_ARMORY, wclUrlTemplate: "https://fresh.warcraftlogs.com/character/eu/x/{char}",
                wowheadPath: "/classic/", softresEdition: "TBC", raidsheetId: "tier45",
            })).toEqual({
                blizzardRegion: "eu", blizzardRealmSlug: "die-aldor", blizzardNamespace: "profile-classic1x-eu",
                armoryUrlTemplate: TBC_ARMORY, wclUrlTemplate: "https://fresh.warcraftlogs.com/character/eu/x/{char}",
                wowheadPath: "classic", softresEdition: "tbc", raidsheetId: "tier45",
            });
        });

        it("drops what would build a broken link or ask a realm that does not exist", () => {
            const out = schema.normalizeBlock({
                blizzardRegion: "mars", blizzardRealmSlug: "bad slug!", blizzardNamespace: "x y",
                armoryUrlTemplate: "https://armory.test/no-placeholder", wclUrlTemplate: "javascript:alert(1)//{char}",
                wowheadPath: "a/b", softresEdition: "forever", raidsheetId: "bad id", extra: "gone",
            });
            expect(out).toEqual(schema.normalizeBlock({}));
            expect(Object.values(out).every((v) => v === "")).toBe(true);
            expect(Object.keys(out)).toEqual(schema.FIELDS);
        });

        it("accepts a template only as an http(s) address with {char}", () => {
            expect(schema.normalizeTemplate("http://x.test/{char}")).toBe("http://x.test/{char}");
            expect(schema.normalizeTemplate("https://{char}")).toBe("https://{char}");
            expect(schema.normalizeTemplate("ftp://x.test/{char}")).toBe("");
            expect(schema.normalizeTemplate(`https://x.test/${"a".repeat(300)}/{char}`)).toBe("");
            expect(schema.normalizeTemplate(null)).toBe("");
        });
    });

    describe("normalizeVersionSettings", () => {
        it("has a block for every known version and none for an unknown one", () => {
            const out = schema.normalizeVersionSettings({ tbc: { wowheadPath: "tbc" }, wotlk: { wowheadPath: "wotlk" } });
            expect(Object.keys(out).sort()).toEqual(["classic", "forever", "tbc"]);
            expect(out.tbc.wowheadPath).toBe("tbc");
            expect(out.forever).toEqual(schema.normalizeBlock({}));
            expect(schema.normalizeVersionSettings("nope").tbc).toEqual(schema.normalizeBlock({}));
            expect(schema.normalizeVersionSettings([]).tbc).toEqual(schema.normalizeBlock({}));
        });
    });

    describe("legacyTbcBlock / versionSettingsOf", () => {
        it("reads the old single values as the TBC block, Forever and Classic empty", () => {
            const out = schema.versionSettingsOf({ blizzard: { clientId: "id", region: "us", realmSlug: "Nightslayer", namespace: "" } });
            expect(out.tbc).toEqual({
                blizzardRegion: "us", blizzardRealmSlug: "nightslayer", blizzardNamespace: "profile-classicann-us",
                armoryUrlTemplate: defaults.applyArmoryUrlTemplate, wclUrlTemplate: defaults.applyWclUrlTemplate,
                wowheadPath: "tbc", softresEdition: "tbc", raidsheetId: "",
            });
            expect(out.forever).toEqual(schema.normalizeBlock({}));
            expect(out.classic).toEqual(schema.normalizeBlock({}));
        });

        it("keeps a stored namespace override and falls back to the bootstrap realm", () => {
            expect(schema.legacyTbcBlock({ blizzard: { namespace: "profile-classic1x-eu" } })).toMatchObject({
                blizzardRegion: "eu", blizzardRealmSlug: "thunderstrike", blizzardNamespace: "profile-classic1x-eu",
            });
            expect(schema.legacyTbcBlock(null).blizzardRealmSlug).toBe("thunderstrike");
        });

        it("reads a stored map as it is: a version emptied on purpose stays empty", () => {
            const out = schema.versionSettingsOf({ blizzard: { realmSlug: "old" }, versionSettings: { tbc: { wowheadPath: "tbc" } } });
            expect(out.tbc).toMatchObject({ wowheadPath: "tbc", blizzardRealmSlug: "", armoryUrlTemplate: "" });
        });
    });
});

// The shape of config.versionSettings (#542): only valid values survive, an
// empty field means "not there for this version", and a config from before
// #542 reads its old single values as the TBC block.
const schema = require("../../src/stores/versionSettingsSchema");
const defaults = require("../../src/config/defaults");

const TBC_ARMORY = "https://classic-armory.org/character/eu/tbc-anniversary/thunderstrike/{char}";

describe("stores/versionSettingsSchema", () => {
    describe("colour (#742)", () => {
        it("keeps only a #rrggbb, lower-cased", () => {
            expect(schema.normalizeBlock({ color: "#AbCdEf" }).color).toBe("#abcdef");
            for (const bad of ["abcdef", "#abc", "#abcdeg", "red", "#1234567", null, 5]) expect(schema.normalizeBlock({ color: bad }).color).toBe("");
        });

        it("falls back to the rule set's colour; every version has one", () => {
            expect(schema.defaultColorOf("forever")).toBe("#4da3ff");
            expect(schema.defaultColorOf("tbc")).toBe("#9bd45a");
            expect(schema.defaultColorOf("classic")).toMatch(/^#[0-9a-f]{6}$/);
            expect(schema.defaultColorOf("wotlk")).toBe("");
            expect(schema.colorOf({}, "forever")).toBe("#4da3ff");
            expect(schema.colorOf({ color: "#112233" }, "forever")).toBe("#112233");
        });

        it("is not part of the standard values button: the default blocks carry no colour", () => {
            expect(schema.defaultBlock("forever").color).toBe("");
            expect(schema.defaultBlock("tbc").color).toBe("");
        });
    });

    describe("normalizeBlock", () => {
        it("keeps valid values and trims, lower-cases and slugs them", () => {
            expect(schema.normalizeBlock({
                blizzardRegion: " EU ", blizzardRealmSlug: "Die Aldor", blizzardNamespace: "Profile-Classic1x-EU",
                armoryUrlTemplate: TBC_ARMORY, wclUrlTemplate: "https://fresh.warcraftlogs.com/character/eu/x/{char}",
                wowheadPath: "/classic/", softresEdition: "TBC", raidsheetId: "tier45", color: " #4DA3FF",
            })).toEqual({
                blizzardRegion: "eu", blizzardRealmSlug: "die-aldor", blizzardNamespace: "profile-classic1x-eu",
                armoryUrlTemplate: TBC_ARMORY, wclUrlTemplate: "https://fresh.warcraftlogs.com/character/eu/x/{char}",
                wowheadPath: "classic", softresEdition: "tbc", raidsheetId: "tier45", color: "#4da3ff",
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

        it("accepts {region} and {realm} beside {char} (#553)", () => {
            const tpl = "https://vanilla.warcraftlogs.com/character/{region}/{realm}/{char}";
            expect(schema.normalizeTemplate(tpl)).toBe(tpl);
            expect(schema.normalizeTemplate("https://x.test/{region}/{realm}")).toBe("");
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
        it("reads the old single values as the TBC block, Classic with its standard values, Forever empty", () => {
            const out = schema.versionSettingsOf({ blizzard: { clientId: "id", region: "us", realmSlug: "Nightslayer", namespace: "" } });
            expect(out.tbc).toEqual({
                blizzardRegion: "us", blizzardRealmSlug: "nightslayer", blizzardNamespace: "profile-classicann-us",
                armoryUrlTemplate: defaults.applyArmoryUrlTemplate, wclUrlTemplate: defaults.applyWclUrlTemplate,
                wowheadPath: "tbc", softresEdition: "tbc", raidsheetId: "", color: "",
            });
            expect(out.forever).toEqual(schema.defaultBlock("forever"));
            expect(out.classic).toEqual(schema.defaultBlock("classic"));
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

    describe("standard values per version (#553)", () => {
        const CLASSIC = {
            blizzardRegion: "eu", blizzardRealmSlug: "", blizzardNamespace: "profile-classic1x-eu",
            armoryUrlTemplate: "https://classic-armory.org/character/{region}/vanilla/{realm}/{char}",
            wclUrlTemplate: "https://vanilla.warcraftlogs.com/character/{region}/{realm}/{char}",
            wowheadPath: "classic", softresEdition: "classic", raidsheetId: "", color: "",
        };

        it("builds Classic's block from its rule set, without a realm", () => {
            expect(schema.defaultBlock("classic")).toEqual(CLASSIC);
        });

        it("takes the region handed in and writes it into the namespace", () => {
            expect(schema.defaultBlock("classic", { region: "US" })).toMatchObject({ blizzardRegion: "us", blizzardNamespace: "profile-classic1x-us" });
            expect(schema.defaultBlock("classic", { region: "mars" }).blizzardRegion).toBe("eu");
        });

        it("has TBC's standard values with placeholders instead of a realm", () => {
            expect(schema.defaultBlock("tbc")).toMatchObject({
                blizzardNamespace: "profile-classicann-eu", blizzardRealmSlug: "",
                wclUrlTemplate: "https://fresh.warcraftlogs.com/character/{region}/{realm}/{char}", wowheadPath: "tbc", softresEdition: "tbc",
            });
        });

        it("gives Forever only its Wowhead path (#750), an unknown version nothing", () => {
            expect(schema.defaultBlock("forever")).toEqual({ ...schema.normalizeBlock({}), blizzardRegion: "eu", wowheadPath: "forever" });
            expect(schema.defaultBlock("wotlk")).toEqual(schema.normalizeBlock({}));
            expect(schema.settingsDefaultsOf("forever")).toEqual({ wowheadPath: "forever" });
            expect(schema.versionsWithDefaults()).toEqual(["tbc", "classic", "forever"]);
        });

        it("defaultVersionSettings gives every version its block, in the region of the stored one", () => {
            const out = schema.defaultVersionSettings({ classic: { blizzardRegion: "us" } });
            expect(Object.keys(out).sort()).toEqual(["classic", "forever", "tbc"]);
            expect(out.classic.blizzardNamespace).toBe("profile-classic1x-us");
            expect(out.tbc.blizzardRegion).toBe("eu");
            expect(schema.defaultVersionSettings(null).classic).toEqual(CLASSIC);
        });

        it("fillDefaults fills only empty fields and names them", () => {
            const { block, filled } = fillOf({ wowheadPath: "classic-custom", blizzardRealmSlug: "firemaw" });
            expect(block).toMatchObject({ wowheadPath: "classic-custom", blizzardRealmSlug: "firemaw", softresEdition: "classic", blizzardNamespace: "profile-classic1x-eu" });
            expect(filled).toEqual(["blizzardRegion", "blizzardNamespace", "armoryUrlTemplate", "wclUrlTemplate", "softresEdition"]);
            expect(schema.fillDefaults(schema.defaultBlock("classic"), "classic").filled).toEqual([]);
            expect(schema.fillDefaults({}, "forever").filled).toEqual(["blizzardRegion", "wowheadPath"]);
            expect(schema.fillDefaults({}, "wotlk")).toEqual({ block: schema.normalizeBlock({}), filled: [] });
        });

        function fillOf(block) {
            return schema.fillDefaults(block, "classic");
        }
    });
});

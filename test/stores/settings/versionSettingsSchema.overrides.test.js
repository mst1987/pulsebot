// A server's own realm and armory/log templates per version (#923, epic #926):
// only the four fields, only valid filled values, field by field over the
// version block - and a filled value that does not pass is named, not dropped
// silently, so the settings route can refuse it.
const schema = require("../../../src/stores/settings/versionSettingsSchema");

const BLOCK = schema.normalizeBlock({
    blizzardRegion: "eu", blizzardRealmSlug: "thunderstrike",
    armoryUrlTemplate: "https://armory.test/{char}", wclUrlTemplate: "https://wcl.test/character/eu/thunderstrike/{char}",
    wowheadPath: "tbc", softresEdition: "tbc",
});

describe("stores/settings/versionSettingsSchema - per-server overrides (#923)", () => {
    it("names exactly the four fields a server may set", () => {
        expect(schema.OVERRIDE_FIELDS).toEqual(["armoryUrlTemplate", "wclUrlTemplate", "blizzardRegion", "blizzardRealmSlug"]);
    });

    describe("normalizeVersionOverrides", () => {
        it("keeps known versions and the four fields with valid filled values only", () => {
            expect(schema.normalizeVersionOverrides({
                tbc: { armoryUrlTemplate: " https://own.test/{char} ", wowheadPath: "classic", color: "#112233", wclUrlTemplate: "" },
                forever: { blizzardRealmSlug: "Everlook", blizzardRegion: "US" },
                nope: { armoryUrlTemplate: "https://x.test/{char}" },
                classic: { armoryUrlTemplate: "no-url" },
                wotlk: {},
            })).toEqual({
                tbc: { armoryUrlTemplate: "https://own.test/{char}" },
                forever: { blizzardRealmSlug: "everlook", blizzardRegion: "us" },
            });
        });

        it("is {} for anything that is no map", () => {
            for (const raw of [null, undefined, "x", 5, [], { tbc: [] }, { tbc: "x" }]) expect(schema.normalizeVersionOverrides(raw)).toEqual({});
        });
    });

    describe("overrideProblems", () => {
        it("names each filled field that would be thrown away, an empty one is no problem", () => {
            const problems = schema.overrideProblems({
                tbc: { armoryUrlTemplate: "https://armory.test/no-placeholder", wclUrlTemplate: "" },
                forever: { blizzardRegion: "mars", blizzardRealmSlug: "everlook" },
            });
            expect(problems).toHaveLength(2);
            expect(problems).toEqual(expect.arrayContaining([
                { versionId: "forever", field: "blizzardRegion" },
                { versionId: "tbc", field: "armoryUrlTemplate" },
            ]));
        });

        it("is empty for a clean map and for no map", () => {
            expect(schema.overrideProblems({ tbc: { armoryUrlTemplate: "https://own.test/{char}" } })).toEqual([]);
            expect(schema.overrideProblems(null)).toEqual([]);
        });
    });

    describe("applyVersionOverrides", () => {
        it("changes only the field the server set and names it", () => {
            const { block, overridden } = schema.applyVersionOverrides(BLOCK, { armoryUrlTemplate: "https://own.test/{char}" });
            expect(block).toEqual({ ...BLOCK, armoryUrlTemplate: "https://own.test/{char}" });
            expect(overridden).toEqual(["armoryUrlTemplate"]);
        });

        it("leaves the block as it is without overrides, and never touches the shared fields", () => {
            expect(schema.applyVersionOverrides(BLOCK, undefined)).toEqual({ block: BLOCK, overridden: [] });
            expect(schema.applyVersionOverrides(BLOCK, { wowheadPath: "classic", softresEdition: "" })).toEqual({ block: BLOCK, overridden: [] });
        });

        it("takes the namespace along with an own region", () => {
            const withNs = { ...BLOCK, blizzardNamespace: "profile-classicann-eu" };
            // suffix of the standard region swapped
            expect(schema.applyVersionOverrides(withNs, { blizzardRegion: "us" }).block.blizzardNamespace).toBe("profile-classicann-us");
            // same region as the standard: untouched
            expect(schema.applyVersionOverrides(withNs, { blizzardRegion: "eu" }).block.blizzardNamespace).toBe("profile-classicann-eu");
            // no suffix to swap: the rule set's {region} template
            const odd = { ...BLOCK, blizzardNamespace: "custom-ns" };
            expect(schema.applyVersionOverrides(odd, { blizzardRegion: "kr" }, "tbc").block.blizzardNamespace).toBe("profile-classicann-kr");
            // neither suffix nor template: kept
            expect(schema.applyVersionOverrides(odd, { blizzardRegion: "kr" }, "nope").block.blizzardNamespace).toBe("custom-ns");
            // realm alone keeps the namespace
            expect(schema.applyVersionOverrides(withNs, { blizzardRealmSlug: "spineshatter" }).block.blizzardNamespace).toBe("profile-classicann-eu");
        });
    });
});

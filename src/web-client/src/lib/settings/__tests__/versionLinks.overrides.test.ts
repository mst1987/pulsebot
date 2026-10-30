// A server's own armory/log templates and realm (#923, epic #926) on the
// client: the same rules as the server's applyVersionOverrides — only the four
// fields, only valid filled values, field by field over the standard.
import { describe, expect, it } from "vitest";
import {
    TEMPLATE_MAX, VERSION_OVERRIDE_FIELDS, blockOf, effectiveBlock, emptyOwnFields, overrideProblems, overridesToSave,
    pickOverride, placeInLinks, templateOk, versionLinks,
} from "../versionLinks";

const TBC = blockOf({
    blizzardRegion: "eu", blizzardRealmSlug: "thunderstrike", blizzardNamespace: "profile-classicann-eu",
    armoryUrlTemplate: "https://armory.test/{region}/{realm}/{char}",
    wclUrlTemplate: "https://fresh.warcraftlogs.com/character/eu/thunderstrike/{char}",
    wowheadPath: "tbc", softresEdition: "tbc",
});

describe("lib/settings/versionLinks - per-server overrides (#923)", () => {
    it("names the same four fields as the server", () => {
        expect([...VERSION_OVERRIDE_FIELDS]).toEqual(["armoryUrlTemplate", "wclUrlTemplate", "blizzardRegion", "blizzardRealmSlug"]);
    });

    it("keeps the standard links without an override", () => {
        expect(versionLinks(TBC, undefined).armory("Devihra")).toBe(versionLinks(TBC).armory("Devihra"));
        expect(versionLinks(TBC, {}).wcl("Devihra")).toBe("https://fresh.warcraftlogs.com/character/eu/thunderstrike/Devihra");
    });

    it("changes only the field the server set; an own realm also lands in the standard template", () => {
        const own = versionLinks(TBC, { wclUrlTemplate: "https://www.warcraftlogs.com/character/eu/x/{char}" });
        expect(own.wcl("Devihra")).toBe("https://www.warcraftlogs.com/character/eu/x/Devihra");
        expect(own.armory("Devihra")).toBe("https://armory.test/eu/thunderstrike/Devihra");
        expect(own.wowheadItem(32837)).toBe(versionLinks(TBC).wowheadItem(32837));
        expect(versionLinks(TBC, { blizzardRealmSlug: "Spineshatter", blizzardRegion: "us" }).armory("Devihra"))
            .toBe("https://armory.test/us/spineshatter/Devihra");
    });

    it("ignores an invalid or empty own value", () => {
        expect(effectiveBlock(TBC, { armoryUrlTemplate: "https://no-placeholder.test/", wclUrlTemplate: "  " })).toEqual(TBC);
    });

    it("names the invalid fields only", () => {
        expect(overrideProblems({ armoryUrlTemplate: "kein-link", blizzardRealmSlug: "everlook", wclUrlTemplate: "" })).toEqual(["armoryUrlTemplate"]);
        expect(overrideProblems(undefined)).toEqual([]);
    });

    it("trims, drops empty fields and fields outside the four, and versions left without a value", () => {
        expect(pickOverride({ armoryUrlTemplate: " https://own.test/{char} ", wclUrlTemplate: "", wowheadPath: "classic" } as never))
            .toEqual({ armoryUrlTemplate: "https://own.test/{char}" });
        expect(overridesToSave({ tbc: { blizzardRealmSlug: "everlook" }, classic: { wclUrlTemplate: "" }, forever: {} }))
            .toEqual({ tbc: { blizzardRealmSlug: "everlook" } });
    });

    it("refuses a template longer than the server keeps (300)", () => {
        const head = "https://own.test/{char}?q=";
        expect(templateOk(head + "x".repeat(TEMPLATE_MAX - head.length))).toBe(true);
        expect(templateOk(head + "x".repeat(TEMPLATE_MAX - head.length + 1))).toBe(false);
        expect(overrideProblems({ wclUrlTemplate: head + "x".repeat(TEMPLATE_MAX) })).toEqual(["wclUrlTemplate"]);
    });

    it("names the fields switched on but left empty", () => {
        expect(emptyOwnFields({ blizzardRealmSlug: "", blizzardRegion: "us", wclUrlTemplate: "  " }))
            .toEqual(["wclUrlTemplate", "blizzardRealmSlug"]);
        expect(emptyOwnFields({})).toEqual([]);
        expect(emptyOwnFields(undefined)).toEqual([]);
    });

    it("says whether realm and region reach the links at all", () => {
        expect(placeInLinks(TBC, "blizzardRealmSlug")).toBe(true);
        expect(placeInLinks(TBC, "blizzardRegion")).toBe(true);
        const plain = effectiveBlock(TBC, { armoryUrlTemplate: "https://own.test/{char}" });
        expect(placeInLinks(plain, "blizzardRealmSlug")).toBe(false);
        expect(placeInLinks(plain, "blizzardRegion")).toBe(false);
    });
});

// Links per game version on the client (#542): the same rules as the server's
// helper — an empty setting leaves the link out, a half-filled template never
// becomes a broken link.
import { describe, expect, it } from "vitest";
import {
    applyDefaults, blockOf, blockProblems, defaultsDiff, emptyBlock, fillCharTemplate, isWebLink, templateOk, versionLinks,
} from "./versionLinks";
import { wowheadItemUrl } from "../wow/wowheadItems";

const TBC = blockOf({
    blizzardRegion: "eu", blizzardRealmSlug: "thunderstrike", blizzardNamespace: "profile-classicann-eu",
    armoryUrlTemplate: "https://classic-armory.org/character/eu/tbc-anniversary/thunderstrike/{char}",
    wclUrlTemplate: "https://fresh.warcraftlogs.com/character/eu/thunderstrike/{char}",
    wowheadPath: "tbc", softresEdition: "tbc",
});

describe("lib/settings/versionLinks", () => {
    it("builds the TBC links as before", () => {
        const links = versionLinks(TBC);
        expect(links.armory("Devihra")).toBe("https://classic-armory.org/character/eu/tbc-anniversary/thunderstrike/Devihra");
        expect(links.wcl("Bärli")).toBe("https://fresh.warcraftlogs.com/character/eu/thunderstrike/B%C3%A4rli");
        expect(links.wowheadItem(281893, ["ench=1"])).toBe("https://www.wowhead.com/tbc/item=37128?ench=1");
    });

    it("leaves every link out for an empty block (Forever until known)", () => {
        const links = versionLinks(emptyBlock());
        expect(links.armory("Devihra")).toBe("");
        expect(links.wcl("Devihra")).toBe("");
        expect(links.wowheadItem(32837)).toBe("");
        expect(wowheadItemUrl(32837, [], "")).toBe("");
        expect(wowheadItemUrl(0)).toBe("");
        expect(wowheadItemUrl(32837)).toBe("https://www.wowhead.com/tbc/item=32837");
    });

    it("fills a template only into a working address", () => {
        expect(fillCharTemplate("https://x.test/{char}", " Nera ")).toBe("https://x.test/Nera");
        expect(fillCharTemplate("x.test/{char}", "Nera")).toBe("");
        expect(fillCharTemplate("https://x.test/{char}", "")).toBe("");
        expect(isWebLink("https://x.test/a")).toBe(true);
        expect(isWebLink("javascript:alert(1)")).toBe(false);
    });

    it("names the fields the server would refuse, never an empty one", () => {
        expect(blockProblems(TBC)).toEqual([]);
        expect(blockProblems(emptyBlock())).toEqual([]);
        expect(blockProblems(blockOf({
            blizzardRegion: "mars", blizzardRealmSlug: "Die Aldor", blizzardNamespace: "a b",
            armoryUrlTemplate: "https://x.test/no-placeholder", wclUrlTemplate: "ftp://x/{char}", wowheadPath: "a/b",
        }))).toEqual(["blizzardRegion", "blizzardNamespace", "armoryUrlTemplate", "wclUrlTemplate", "wowheadPath"]);
        expect(templateOk("")).toBe(true);
    });

    it("fills a stored block up to every field", () => {
        expect(blockOf(undefined)).toEqual(emptyBlock());
        expect(blockOf({ wowheadPath: "classic" }).wowheadPath).toBe("classic");
    });
});

describe("{region}/{realm} templates and standard values (#553)", () => {
    const CLASSIC_STD = blockOf({
        blizzardRegion: "eu", blizzardNamespace: "profile-classic1x-eu",
        armoryUrlTemplate: "https://classic-armory.org/character/{region}/vanilla/{realm}/{char}",
        wclUrlTemplate: "https://vanilla.warcraftlogs.com/character/{region}/{realm}/{char}",
        wowheadPath: "classic", softresEdition: "classic",
    });

    it("accepts the placeholders and fills them from the block", () => {
        expect(templateOk(CLASSIC_STD.wclUrlTemplate)).toBe(true);
        const links = versionLinks({ ...CLASSIC_STD, blizzardRealmSlug: "Firemaw" });
        expect(links.wcl("Nera")).toBe("https://vanilla.warcraftlogs.com/character/eu/firemaw/Nera");
        expect(links.armory("Nera")).toBe("https://classic-armory.org/character/eu/vanilla/firemaw/Nera");
    });

    it("leaves the link out without a realm", () => {
        expect(versionLinks(CLASSIC_STD).wcl("Nera")).toBe("");
        expect(fillCharTemplate("https://x.test/{region}/{char}", "Nera")).toBe("");
        expect(fillCharTemplate("https://x.test/{region}/{char}", "Nera", { region: "us" })).toBe("https://x.test/us/Nera");
    });

    it("takes over only the fields with a standard value, never the realm", () => {
        const own = blockOf({ blizzardRealmSlug: "firemaw", wowheadPath: "mine", raidsheetId: "s1" });
        expect(defaultsDiff(own, CLASSIC_STD)).toEqual(["blizzardRegion", "blizzardNamespace", "armoryUrlTemplate", "wclUrlTemplate", "wowheadPath", "softresEdition"]);
        const out = applyDefaults(own, CLASSIC_STD);
        expect(out).toMatchObject({ blizzardRealmSlug: "firemaw", raidsheetId: "s1", wowheadPath: "classic", softresEdition: "classic" });
        expect(defaultsDiff(out, CLASSIC_STD)).toEqual([]);
        expect(defaultsDiff(own, undefined)).toEqual([]);
        expect(applyDefaults(own, emptyBlock())).toEqual(own);
    });
});

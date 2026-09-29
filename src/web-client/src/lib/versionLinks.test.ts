// Links per game version on the client (#542): the same rules as the server's
// helper — an empty setting leaves the link out, a half-filled template never
// becomes a broken link.
import { describe, expect, it } from "vitest";
import {
    blockOf, blockProblems, emptyBlock, fillCharTemplate, isWebLink, templateOk, versionLinks,
} from "./versionLinks";
import { wowheadItemUrl } from "./wowheadItems";

const TBC = blockOf({
    blizzardRegion: "eu", blizzardRealmSlug: "thunderstrike", blizzardNamespace: "profile-classicann-eu",
    armoryUrlTemplate: "https://classic-armory.org/character/eu/tbc-anniversary/thunderstrike/{char}",
    wclUrlTemplate: "https://fresh.warcraftlogs.com/character/eu/thunderstrike/{char}",
    wowheadPath: "tbc", softresEdition: "tbc",
});

describe("lib/versionLinks", () => {
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

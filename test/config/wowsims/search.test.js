const wowsims = require("../../../src/config/wowsims");

describe("config/wowsims — searchItems", () => {
    it("finds an item by a piece of its name", () => {
        const hits = wowsims.searchItems("Absolution");
        expect(hits.length).toBeGreaterThan(0);
        for (const hit of hits) expect(hit.name.toLowerCase()).toContain("absolution");
    });

    it("is case-insensitive", () => {
        expect(wowsims.searchItems("absolution").length).toBe(wowsims.searchItems("ABSOLUTION").length);
    });

    it("returns everything the picker needs to render a row", () => {
        const [hit] = wowsims.searchItems("Absolution");
        expect(hit).toMatchObject({
            id: expect.any(Number),
            name: expect.any(String),
            iconUrl: expect.stringContaining("zamimg.com"),
            quality: expect.any(Number),
            ilvl: expect.any(Number),
        });
    });

    it("ranks a name that starts with the query above one that merely contains it", () => {
        const hits = wowsims.searchItems("Hood");
        const startsAt = hits.findIndex((h) => h.name.toLowerCase().startsWith("hood"));
        const containsAt = hits.findIndex((h) => !h.name.toLowerCase().startsWith("hood"));
        if (startsAt >= 0 && containsAt >= 0) expect(startsAt).toBeLessThan(containsAt);
    });

    it("puts the higher item level first among equal matches", () => {
        const hits = wowsims.searchItems("Robe");
        const starting = hits.filter((h) => h.name.toLowerCase().startsWith("robe"));
        for (let i = 1; i < starting.length; i += 1) {
            expect(starting[i - 1].ilvl).toBeGreaterThanOrEqual(starting[i].ilvl);
        }
    });

    it("ignores a query too short to mean anything", () => {
        expect(wowsims.searchItems("a")).toEqual([]);
        expect(wowsims.searchItems("")).toEqual([]);
        expect(wowsims.searchItems(null)).toEqual([]);
    });

    it("caps the result list", () => {
        // "of" matches hundreds of items; the picker shows a dozen.
        expect(wowsims.searchItems("of").length).toBeLessThanOrEqual(15);
        expect(wowsims.searchItems("of", { limit: 3 }).length).toBe(3);
    });

    it("only offers items that resolve to an equip slot", () => {
        // Every hit has to be answerable ("who could wear this?"), which is the
        // reason the search runs against this table instead of Wowhead.
        for (const hit of wowsims.searchItems("Robe")) {
            expect(wowsims.slotsFor(hit.id).length).toBeGreaterThan(0);
        }
    });

    it("finds nothing for a name no caster item has", () => {
        expect(wowsims.searchItems("Zzzzunmoeglich")).toEqual([]);
    });
});

// TBC Anniversary re-issued the Brewfest loot under ids Wowhead does not know
// (404 on the tooltip, "not found" on the page) — links go to the original.
const fs = require("fs");
const path = require("path");
const { WOWHEAD_ITEM_ALIASES, wowheadItemId, wowheadLink } = require("../../src/config/wowheadItemAliases");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");

describe("config/wowheadItemAliases", () => {
    it("maps a re-issue to the original and leaves every other id alone", () => {
        expect(wowheadItemId(281895)).toBe(37127);
        expect(wowheadItemId("281735")).toBe(38290);
        expect(wowheadItemId(28830)).toBe(28830);
    });

    it("rewrites stored links and leaves every other link alone", () => {
        expect(wowheadLink("https://www.wowhead.com/tbc/item=281748")).toBe("https://www.wowhead.com/tbc/item=38288");
        expect(wowheadLink("https://www.wowhead.com/tbc/item=28830")).toBe("https://www.wowhead.com/tbc/item=28830");
        expect(wowheadLink("")).toBe("");
        expect(wowheadLink(undefined)).toBe("");
    });

    it("keeps the client's copy of the table equal to the server's", () => {
        const src = fs.readFileSync(path.join(CLIENT, "lib", "wowheadItems.ts"), "utf8");
        const client = {};
        for (const m of src.matchAll(/^\s*(\d+): (\d+),/gm)) client[m[1]] = Number(m[2]);
        expect(client).toEqual({ ...WOWHEAD_ITEM_ALIASES });
    });

    it("sends every item link of the SPA through the table", () => {
        const hits = [];
        const walk = (dir) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) walk(p);
                // the client's own tests (Vitest, *.test.ts(x)) may spell a link out as an expectation
                else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && e.name !== "wowheadItems.ts"
                    && fs.readFileSync(p, "utf8").includes("wowhead.com/tbc/item=")) hits.push(e.name);
            }
        };
        walk(CLIENT);
        expect(hits).toEqual([]);
    });
});

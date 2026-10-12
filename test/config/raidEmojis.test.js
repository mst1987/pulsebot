const fs = require("fs");
const path = require("path");
const { RAID_EMOJIS, raidEmojiSuggestions } = require("../../src/config/raidEmojis");

const TWIN = fs.readFileSync(path.join(__dirname, "..", "..", "src", "web-client", "src", "lib", "raids", "raidEmojis.ts"), "utf8");

/** The RAID_EMOJIS table of the client's file: `id: ["…", …],` lines between `= {` and `};`. */
function clientTable() {
    const body = TWIN.slice(TWIN.indexOf("RAID_EMOJIS: Record<string, string[]> = {"), TWIN.indexOf("};"));
    const out = {};
    for (const m of body.matchAll(/^\s*"?([\w-]+)"?:\s*(\[.*\]),\s*$/gm)) out[m[1]] = JSON.parse(m[2]);
    return out;
}

describe("config/raidEmojis", () => {
    it("is the same table as the web client's lib/raids/raidEmojis.ts", () => {
        expect(Object.keys(clientTable()).length).toBeGreaterThan(10);
        expect(RAID_EMOJIS).toEqual(clientTable());
    });

    it("suggests the emojis of the chosen raids without repeats, at most `max`", () => {
        expect(raidEmojiSuggestions(["ssc", "tk"])).toEqual(["🐍", "🌊", "🐙", "🐟", "🔥", "🦅", "☄️", "🌌"]);
        expect(raidEmojiSuggestions(["ssc", "tk"], 3)).toEqual(["🐍", "🌊", "🐙"]);
        expect(raidEmojiSuggestions(["unknown"])).toEqual([]);
        expect(raidEmojiSuggestions(undefined)).toEqual([]);
    });

    it("keeps the client's default of ten suggestions", () => {
        expect(TWIN).toContain("max = 10");
        expect(raidEmojiSuggestions(Object.keys(RAID_EMOJIS))).toHaveLength(10);
    });
});

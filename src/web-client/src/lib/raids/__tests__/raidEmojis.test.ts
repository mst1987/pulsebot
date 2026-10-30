// The emojis the picker suggests for a raid (lib/raids/raidEmojis.ts).
import { describe, expect, it } from "vitest";
import { requireBackend } from "../../../test/backend";
import { emojiKey, loadEmojis } from "../../discord/emoji";
import { RAID_EMOJIS, instanceIdsOfTag, raidEmojiSuggestions } from "../raidEmojis";

describe("raidEmojiSuggestions", () => {
    it("suggests the raid's emojis, the first one first", () => {
        expect(raidEmojiSuggestions(["za"])[0]).toBe("🐻");
    });

    it("joins several raids without repeats and keeps to the maximum", () => {
        const both = raidEmojiSuggestions(["ssc", "tk"]);
        expect(both.slice(0, 4)).toEqual(RAID_EMOJIS.ssc);
        expect(new Set(both).size).toBe(both.length);
        expect(raidEmojiSuggestions(["za", "zg", "naxx"], 5)).toHaveLength(5);
    });

    it("gives a Forever instance its own row and knows nothing of unknown ids", () => {
        expect(raidEmojiSuggestions(["forever-hyjal"])).toEqual(RAID_EMOJIS["forever-hyjal"]);
        expect(raidEmojiSuggestions(["forever-barrow"])).toEqual(RAID_EMOJIS["forever-barrow"]);
        expect(raidEmojiSuggestions(["unknown"])).toEqual([]);
    });

    it("has a row for every instance of every game version (#749)", () => {
        const { VERSIONS } = requireBackend<{ VERSIONS: { instances: { id: string }[] }[] }>("config/gameVersions");
        const missing = VERSIONS.flatMap((v) => v.instances.map((i) => i.id)).filter((id) => !RAID_EMOJIS[id]);
        expect(missing).toEqual([]);
    });

    it("offers only emojis the picker itself has (Emoji 12.1, no flags)", async () => {
        const known = new Set((await loadEmojis("de")).map((e) => emojiKey(e.e)));
        const missing = Object.values(RAID_EMOJIS).flat().filter((e) => !known.has(emojiKey(e)));
        expect(missing).toEqual([]);
    });
});

describe("instanceIdsOfTag", () => {
    it("reads the raids out of a tag or a channel name", () => {
        expect(instanceIdsOfTag("ssc-tk")).toEqual(["ssc", "tk"]);
        expect(instanceIdsOfTag("🐍・mi-16-09-za")).toEqual(["za"]);
        expect(instanceIdsOfTag("ZA")).toEqual(["za"]);
        expect(instanceIdsOfTag("allgemein")).toEqual([]);
        expect(instanceIdsOfTag("")).toEqual([]);
    });
});

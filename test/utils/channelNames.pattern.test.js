// Patterns typed by hand for a new event's channel ("Kanalname anpassen …").
const { renderChannelName, unknownPlaceholders, patternText, derivePatternFromName, PATTERN_KEYS } = require("../../src/utils/channelNames");
const { stripLeadEmoji, setLeadEmoji } = require("../../src/utils/leadEmoji");

describe("renderChannelName — the spellings a derived name carries", () => {
    it("knows unpadded day/month and the weekday in full or English", () => {
        expect(renderChannelName("{d}-{m}", { date: "2026-10-07" })).toBe("7-10");
        expect(renderChannelName("{wochentag}-{wday}-{weekday}", { date: "2026-10-07" })).toBe("mittwoch-wed-wednesday");
        expect(renderChannelName("{tag}-{dd}-{mon}-{yyyy}", { date: "2026-10-07" })).toBe("mi-07-oct-2026");
    });
});

describe("unknownPlaceholders", () => {
    it("lists the words in braces rendering would drop, once each", () => {
        expect(unknownPlaceholders("a-{dd}-{foo}-{FOO}-{nr}-{raid}")).toEqual(["foo", "nr"]);
        expect(unknownPlaceholders("plain")).toEqual([]);
        expect(PATTERN_KEYS).toEqual(expect.arrayContaining(["dd", "mm", "mon", "tag", "raid"]));
    });
});

describe("patternText — a derived pattern as the text to edit", () => {
    const pattern = derivePatternFromName("🏔️👑》mi-07-oct-ssc-tk", { date: "2026-10-07", raidTags: [["ssc", "tk"]] });

    it("turns date, weekday and raid back into placeholders", () => {
        expect(patternText(pattern, { raid: "ssc-tk" })).toBe("🏔️👑》{tag}-{dd}-{mon}-{raid}");
    });

    it("keeps the old raid when the new event has none", () => {
        expect(patternText(pattern, { raid: "" })).toBe("🏔️👑》{tag}-{dd}-{mon}-ssc-tk");
    });

    it("rendering the text for the same day gives the name it came from", () => {
        expect(renderChannelName(patternText(pattern, { raid: "ssc-tk" }), { date: "2026-10-07", raid: "ssc-tk" })).toBe("🏔️👑》mi-07-oct-ssc-tk");
    });
});

describe("leadEmoji with patterns", () => {
    it("stripping the icon of a pattern keeps its first placeholder", () => {
        expect(stripLeadEmoji("🏔️👑》{raid}-{dd}")).toBe("{raid}-{dd}");
        expect(stripLeadEmoji("🏔️👑》ssc-tk")).toBe("ssc-tk");
    });

    it("putting an icon in front of a pattern that starts with a placeholder adds the separator", () => {
        expect(setLeadEmoji("{raid}-{dd}", "🐍", "・")).toBe("🐍・{raid}-{dd}");
    });
});

// #285: Discord's name rules with emojis and symbols, and a new event channel
// named after the previous one — only its date, weekday and raid replaced.
const fs = require("fs");
const path = require("path");
const names = require("../../src/utils/channelNames");

const {
    normalizeChannelName, derivePatternFromName, applyPattern, patternParts, prefixOf, describeReplaced, listParts, placementFor,
} = names;

const SSC_TK = [["ssc", "tk"]];
const derive = (name, date, raidTags = SSC_TK) => derivePatternFromName(name, { date, raidTags });
const next = (name, oldDate, newDate, raid) => applyPattern(derive(name, oldDate), { date: newDate, raid });

describe("utils/channelNames — Discord's naming rules (#285)", () => {
    it.each([
        ["🔥・mi-16-09-ssc-tk", "🔥・mi-16-09-ssc-tk"],
        ["【Mi】16-09・SSC-TK", "【mi】16-09・ssc-tk"],
        ["⚔┃Donnerstag 17-09 Hyjal BT", "⚔┃donnerstag-17-09-hyjal-bt"],
        ["ssc-tk-16.09", "ssc-tk-1609"],
        ["raid-2026-09-16", "raid-2026-09-16"],
        ["Raid (SSC+TK)!", "raid-ssctk"],
        ["über_größe", "über_größe"],
        ["a{b}c`d~e|f\\g'h\"i", "abcdefghi"],
        ["🌙│ kara · pug", "🌙│-kara-·-pug"],
    ])("%s → %s", (input, expected) => {
        expect(normalizeChannelName(input)).toBe(expected);
    });

    it("strips exactly the ASCII punctuation Discord strips, nothing else", () => {
        const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("");
        expect(normalizeChannelName(ascii, { final: false })).toBe("0123456789abcdefghijklmnopqrstuvwxyz_abcdefghijklmnopqrstuvwxyz");
        expect(normalizeChannelName("・│┃【】⚔✦★")).toBe("・│┃【】⚔✦★");
    });

    it("keeps the web client's twins on the same rule", () => {
        const source = names.NAME_STRIP_RE.source;
        const read = (...p) => fs.readFileSync(path.join(__dirname, "..", "..", "src", "web-client", "src", ...p), "utf8");
        expect(read("lib", "channelNames.ts")).toContain(`/${source}/gu`);
        // schemaName() in lib/eventPlan.ts inlines the same regex
        expect(read("lib", "eventPlan.ts")).toContain(`.replace(/${source}/gu, "")`);
    });
});

describe("utils/channelNames — deriving a name from the previous channel (#285)", () => {
    it.each([
        // name, old event day, new day, raid → new name
        ["🔥・mi-16-09-ssc-tk", "2026-09-16", "2026-09-23", "", "🔥・mi-23-09-ssc-tk"],
        ["【mi】16-09・ssc-tk", "2026-09-16", "2026-09-24", "", "【do】24-09・ssc-tk"],
        ["⚔┃donnerstag-17-09-hyjal-bt", "2026-09-17", "2026-09-23", "", "⚔┃mittwoch-23-09-hyjal-bt"],
        ["ssc-tk-1609", "2026-09-16", "2026-10-07", "", "ssc-tk-0710"],
        ["raid-2026-09-16", "2026-09-16", "2027-01-06", "", "raid-2027-01-06"],
        ["wed-16_09_26-ssctk", "2026-09-16", "2026-09-24", "hyjal-bt", "thu-24_09_26-hyjalbt"],
        ["t6-do-17-9-25er", "2026-09-17", "2026-10-01", "", "t6-do-1-10-25er"],
        ["🔥・mi-16-09-ssc-tk", "2026-09-16", "2026-09-23", "hyjal-bt", "🔥・mi-23-09-hyjal-bt"],
    ])("%s (%s) → %s: %s", (name, oldDay, newDay, raid, expected) => {
        const pattern = derive(name, oldDay);
        expect(pattern.recognized).toBe(true);
        expect(applyPattern(pattern, { date: newDay, raid }).name).toBe(expected);
    });

    it("only touches what matches the old event's own values", () => {
        // "25er", "t6" and a date that is not the event's stay as they are
        const r = next("t6-25er-mi-10-09-ssc", "2026-09-16", "2026-09-23");
        expect(derive("t6-25er-mi-10-09-ssc", "2026-09-16").recognized).toBe(false);
        expect(r.name).toBe("t6-25er-mi-10-09-ssc");
        // the weekday of another day is not replaced either
        expect(next("do-16-09-ssc-tk", "2026-09-16", "2026-09-23").name).toBe("do-23-09-ssc-tk");
        // a digit run that merely contains the date is no date
        expect(derive("raid-116-09", "2026-09-16").recognized).toBe(false);
        // a raid that is part of a longer word stays
        expect(next("mi-16-09-sscx", "2026-09-16", "2026-09-23", "bt").name).toBe("mi-23-09-sscx");
    });

    it("keeps the old raid without a new one, and the old date without a day", () => {
        expect(next("mi-16-09-ssc-tk", "2026-09-16", "2026-09-23", "").name).toBe("mi-23-09-ssc-tk");
        const pattern = derive("mi-16-09-ssc-tk", "2026-09-16");
        expect(applyPattern(pattern, {}).name).toBe("mi-16-09-ssc-tk");
        expect(patternParts(pattern)).toEqual(["weekday", "date", "raid"]);
        expect(listParts(patternParts(pattern))).toBe("Wochentag, Datum und Raid");
    });

    it("says what changed, only what changed", () => {
        const { replaced } = next("🔥・mi-16-09-ssc-tk", "2026-09-16", "2026-09-23", "hyjal-bt");
        expect(replaced).toEqual([
            { part: "weekday", from: "mi", to: "mi" },
            { part: "date", from: "16-09", to: "23-09" },
            { part: "raid", from: "ssc-tk", to: "hyjal-bt" },
        ]);
        expect(describeReplaced(replaced)).toBe("Datum 16-09 → 23-09, Raid ssc-tk → hyjal-bt");
    });

    it("recognises nothing without a date and takes only a symbol prefix", () => {
        expect(derive("🔥・kara-pug", "2026-09-16").recognized).toBe(false);
        expect(derive("mi-ssc-tk", "2026-09-16").recognized).toBe(false); // a weekday alone is no date
        expect(derive("mi-16-09", "").recognized).toBe(false);
        expect(prefixOf("🔥・kara-pug")).toBe("🔥・");
        expect(prefixOf("⚔┃donnerstag")).toBe("⚔┃");
        expect(prefixOf("kara-pug")).toBe("");
        expect(prefixOf("_-kara")).toBe("");
    });

    it("sorts a new channel in behind the previous date, else before the next", () => {
        const rows = [
            { day: "2026-09-09", channelId: "a" },
            { day: "2026-09-16", channelId: "b" },
            { day: "2026-09-30", channelId: "d" },
        ];
        expect(placementFor(rows, "2026-09-23")).toEqual({ afterChannelId: "b" });
        expect(placementFor(rows, "2026-09-16")).toEqual({ afterChannelId: "b" });
        expect(placementFor(rows, "2026-10-07")).toEqual({ afterChannelId: "d" });
        expect(placementFor(rows, "2026-09-01")).toEqual({ beforeChannelId: "a" });
        expect(placementFor([], "2026-09-23")).toEqual({});
        expect(placementFor(rows, "")).toEqual({});
    });
});

const fs = require("fs");
const path = require("path");
const names = require("../../src/utils/channelNames");

const {
    normalizeChannelName, normalizeForType, renderChannelName, seriesDays, planChannels, parseDay,
} = names;

const TWIN = fs.readFileSync(path.join(__dirname, "..", "..", "src", "web-client", "src", "lib", "channelNames.ts"), "utf8");

describe("utils/channelNames", () => {
    describe("normalizeChannelName", () => {
        it("applies Discord's rules: lower case, dashes, no punctuation", () => {
            expect(normalizeChannelName("  Mi 24.09 SSC + TK! ")).toBe("mi-2409-ssc-tk");
            expect(normalizeChannelName("Raid---Abend")).toBe("raid-abend");
            expect(normalizeChannelName("über_größe")).toBe("über_größe");
        });

        it("keeps a trailing dash only while typing", () => {
            expect(normalizeChannelName("mi-", { final: false })).toBe("mi-");
            expect(normalizeChannelName("mi-")).toBe("mi");
            expect(normalizeChannelName("-mi")).toBe("mi");
        });

        it("cuts at 100 characters", () => {
            expect(normalizeChannelName("a".repeat(150))).toHaveLength(100);
        });

        it("leaves voice names their case and spaces", () => {
            expect(normalizeForType("  Raid  Voice ", 2)).toBe("Raid Voice");
            expect(normalizeForType("Raid Voice", 0)).toBe("raid-voice");
        });
    });

    describe("renderChannelName", () => {
        it("fills the default schema from a date and the raid", () => {
            expect(renderChannelName("{tag}-{dd}-{mm}-{raid}", { date: "2026-09-23", raid: "SSC TK" })).toBe("mi-23-09-ssc-tk");
        });

        it("writes the month in three English letters ({mon})", () => {
            const months = Array.from({ length: 12 }, (_, i) => renderChannelName("{mon}", { date: `2026-${String(i + 1).padStart(2, "0")}-01` }));
            expect(months).toEqual(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]);
            expect(renderChannelName("🔥・{tag}-{dd}-{mon}-{raid}", { date: "2026-10-07", raid: "bt" })).toBe("🔥・mi-07-oct-bt");
            expect(renderChannelName("{dd}-{mon}", {})).toBe("");
        });

        it("knows year, old name and number, and drops unknown placeholders", () => {
            expect(renderChannelName("{name}-{yyyy}-{yy}-{nr}{foo}", { date: "2026-01-02", name: "kara", nr: 3 })).toBe("kara-2026-26-3");
        });

        it("lets a fixed tag win over the weekday", () => {
            expect(renderChannelName("{tag}-{raid}", { date: "2026-09-23", tag: "pug", raid: "kara" })).toBe("pug-kara");
        });

        it("renders without a date by leaving the date parts out", () => {
            expect(renderChannelName("{tag}-{dd}-{raid}", { raid: "bt" })).toBe("bt");
        });
    });

    describe("seriesDays / planChannels", () => {
        it("rejects days that do not exist", () => {
            expect(parseDay("2026-02-30")).toBeNull();
            expect(seriesDays("kaputt", 3, "weekly")).toEqual([]);
        });

        it("builds a weekly series and a single day", () => {
            expect(seriesDays("2026-09-23", 3, "weekly")).toEqual(["2026-09-23", "2026-09-30", "2026-10-07"]);
            expect(seriesDays("2026-09-23", 3, "once")).toEqual(["2026-09-23"]);
            expect(seriesDays("2026-09-23", 99, "weekly")).toHaveLength(names.MAX_SERIES);
        });

        it("marks names that exist on the server or twice in the plan", () => {
            const plan = planChannels({
                schema: "{tag}-{raid}", raid: "kara", from: "2026-09-23", count: 3, interval: "weekly",
                existingNames: ["MI-KARA-OLD"],
            });
            expect(plan.map((p) => [p.name, p.exists])).toEqual([["mi-kara", false], ["mi-kara", true], ["mi-kara", true]]);
            const second = planChannels({ schema: "{tag}-{dd}-{mm}-{raid}", raid: "kara", from: "2026-09-23", count: 2, interval: "weekly", existingNames: ["mi-23-09-kara"] });
            expect(second.map((p) => p.exists)).toEqual([true, false]);
        });
    });

    it("keeps the client twin's rules identical", () => {
        expect(TWIN).toContain(`export const NAME_STRIP_RE = /${names.NAME_STRIP_RE.source}/${names.NAME_STRIP_RE.flags};`);
        expect(TWIN).toContain(`export const CHANNEL_NAME_MAX = ${names.CHANNEL_NAME_MAX};`);
        const body = (src) => src.slice(src.indexOf(".toLowerCase()"), src.indexOf("return name.slice"));
        const squash = (s) => s.replace(/\s+/g, "");
        expect(squash(body(TWIN))).toBe(squash(body(fs.readFileSync(require.resolve("../../src/utils/channelNames"), "utf8"))));
    });
});

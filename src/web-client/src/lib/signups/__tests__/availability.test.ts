// The pure rules of the absence/attendance section and dialog.
import { afterEach, describe, expect, it } from "vitest";
import type { AvailabilityCharacter, AvailabilityResult, AvailabilityServer } from "../../../api";
import { t } from "../../../i18n";
import { switchLang } from "../../../test/i18n";
import {
    characterGroups, charactersInput, charsFromEntry, countResults, dayMs, effectiveChars, entryCharacters, firstSpec, initialScope,
    categoryNames, nextTo, periodLabel, pickedVersions, raidFixed, resultSummary, scopeFromEntry, scopeLabel, scopeParts, setCharSpec, skipReason,
    staysAsIs, toggleCategory, toggleChar, toggleServer,
} from "../availability";
import { formatDayDate } from "../../format";
import { specLabel } from "../../wow/wowNames";

const SERVERS: AvailabilityServer[] = [
    { guildId: "g1", name: "Pulse", icon: "", categories: [{ id: "c1", name: "Kara", icon: "", versionId: "tbc" }, { id: "c2", name: "Forever", icon: "", versionId: "forever" }] },
    { guildId: "g2", name: "PuGs", icon: "", categories: [{ id: "c3", name: "PuG", icon: "", versionId: "tbc" }] },
];
const char = (key: string, versionId: string, specs: [string, string][] = [[`${key}-a`, "usable"], [`${key}-b`, "ready"]]): AvailabilityCharacter => ({
    key, name: key[0].toUpperCase() + key.slice(1), className: "Priest", versionId, specs: specs.map(([k, gear]) => ({ key: k, label: k, gear })),
});
const CHARS = [char("one", "tbc"), char("two", "tbc"), char("fv", "forever")];

const result = (over: Partial<AvailabilityResult> = {}): AvailabilityResult => ({
    eventId: "e1", title: "Kara", startTime: 1_790_000_000, ok: true, skipped: "", error: "", ...over,
});

afterEach(() => switchLang("de"));

describe("availability rules", () => {
    it("knows the raids a save leaves alone anyway", () => {
        expect(staysAsIs("presence", "")).toBe(false);
        expect(staysAsIs("presence", "tentative")).toBe(true);
        expect(staysAsIs("presence", "absence")).toBe(true);
        expect(staysAsIs("absence", "signed")).toBe(false);
        expect(staysAsIs("absence", "absence")).toBe(true);
    });

    it("reads a day as noon UTC, so the guild's calendar day stays the same", () => {
        expect(new Date(dayMs("2026-10-05")).toISOString()).toBe("2026-10-05T12:00:00.000Z");
        expect(dayMs("05.10.2026")).toBe(0);
        expect(dayMs("")).toBe(0);
    });

    it("writes a period with its weekdays, one day once", () => {
        expect(periodLabel("2026-10-05", "2026-10-09")).toBe(`${formatDayDate(dayMs("2026-10-05"))} – ${formatDayDate(dayMs("2026-10-09"))}`);
        expect(periodLabel("2026-10-05", "2026-10-05")).toBe(formatDayDate(dayMs("2026-10-05")));
        expect(periodLabel("2026-10-05", "2026-10-05")).toBe("Mo 05.10.");
    });

    it("moves 'Bis' along only when 'Von' passes it", () => {
        expect(nextTo("2026-10-07", "2026-10-05")).toBe("2026-10-07");
        expect(nextTo("2026-10-03", "2026-10-05")).toBe("2026-10-05");
        expect(nextTo("2026-10-03", "")).toBe("2026-10-03");
    });

    it("suggests the first raid-ready spec, else the first", () => {
        const c = (gears: string[]) => ({ key: "k", name: "N", className: "Priest", versionId: "tbc", specs: gears.map((gear, i) => ({ key: `s${i}`, label: `S${i}`, gear })) });
        expect(firstSpec(c(["usable", "ready"]))).toBe("s1");
        expect(firstSpec(c(["usable", "usable"]))).toBe("s0");
        expect(firstSpec(c([]))).toBe("");
        expect(firstSpec(undefined)).toBe("");
    });

    it("counts and sums up what a save did", () => {
        const results = [result(), result({ eventId: "e2" }), result({ eventId: "e3", ok: false, skipped: "already_absent" }), result({ eventId: "e4", ok: false, error: "Anmeldung geschlossen" })];
        expect(countResults(results)).toEqual({ done: 2, skipped: 1, failed: 1 });
        expect(resultSummary("absence", results, true)).toBe([
            t("signups.availability.result.signedOff", { count: 2 }),
            t("signups.availability.result.skipped", { count: 1 }),
            t("signups.availability.result.failed", { count: 1 }),
        ].join(" · "));
        expect(resultSummary("presence", [result()], false)).toBe(`${t("signups.availability.result.signedUp", { count: 1 })} · ${t("signups.availability.result.noDm")}`);
        expect(resultSummary("absence", [], true)).toBe(t("signups.availability.result.noRaid"));
    });

    it("says why a raid was left alone: the skip in words, else the server's reason", async () => {
        expect(skipReason(result())).toBe("");
        expect(skipReason(result({ ok: false, skipped: "already_signed" }))).toBe(t("signups.availability.skip.already_signed"));
        expect(skipReason(result({ ok: false, error: "Anmeldeschluss vorbei" }))).toBe("Anmeldeschluss vorbei");
        await switchLang("en");
        expect(skipReason(result({ ok: false, skipped: "absent" }))).toBe("an absence covers it");
    });

    it("keeps a raid an edited entry already changed fixed, and one another absence covers for an attendance", () => {
        expect(raidFixed("absence", { status: "", applied: true })).toBe(true);
        expect(raidFixed("presence", { status: "", absent: true })).toBe(true);
        expect(raidFixed("absence", { status: "", absent: true })).toBe(false);
        expect(raidFixed("absence", { status: "signed" })).toBe(false);
    });
});

describe("where an entry holds", () => {
    it("starts on the page's category, else the active server, else the first; nothing without servers", () => {
        expect(initialScope(SERVERS, { categoryId: "c3" })).toEqual({ g2: ["c3"] });
        expect(initialScope(SERVERS, { categoryId: "gone", activeGuildId: "g2" })).toEqual({ g2: "all" });
        expect(initialScope(SERVERS, { activeGuildId: "nope" })).toEqual({ g1: "all" });
        expect(initialScope([])).toEqual({});
    });

    it("reads an edited entry's scope; an older one-category entry on its server; no scope = everywhere", () => {
        const scope = [{ guildId: "g1", name: "Pulse", categories: [{ id: "c2", name: "Forever" }] }, { guildId: "g2", name: "PuGs", categories: [] }];
        expect(scopeFromEntry({ scope, categoryId: "" }, SERVERS)).toEqual({ g1: ["c2"], g2: "all" });
        expect(scopeFromEntry({ scope: [{ guildId: "", name: "", categories: [{ id: "c3", name: "" }] }], categoryId: "" }, SERVERS)).toEqual({ g2: ["c3"] });
        expect(scopeFromEntry({ categoryId: "c1" }, SERVERS)).toEqual({ g1: ["c1"] });
        expect(scopeFromEntry({ scope: [], categoryId: "" }, SERVERS)).toEqual({ g1: "all", g2: "all" });
    });

    it("toggles a server's 'all' and single categories; the last one off drops the server", () => {
        expect(toggleServer({}, "g1")).toEqual({ g1: "all" });
        expect(toggleServer({ g1: "all" }, "g1")).toEqual({});
        expect(toggleServer({ g1: ["c1"] }, "g1")).toEqual({ g1: "all" });
        expect(toggleCategory({ g1: "all" }, "g1", "c2")).toEqual({ g1: ["c2"] });
        expect(toggleCategory({ g1: ["c2"] }, "g1", "c1")).toEqual({ g1: ["c2", "c1"] });
        expect(toggleCategory({ g1: ["c2"] }, "g1", "c2")).toEqual({});
    });

    it("writes the body's scope in the servers' order, categories in theirs, unknown ones dropped", () => {
        expect(scopeParts({ g2: "all", g1: ["c2", "c1"] }, SERVERS)).toEqual([{ guildId: "g1", categoryIds: ["c1", "c2"] }, { guildId: "g2", categoryIds: [] }]);
        expect(scopeParts({ g1: ["gone"], g9: "all" }, SERVERS)).toEqual([]);
    });

    it("knows the versions picked; unknown ones mean any", () => {
        expect(pickedVersions({ g1: "all" }, SERVERS)).toEqual(["tbc", "forever"]);
        expect(pickedVersions({ g1: ["c1"], g2: "all" }, SERVERS)).toEqual(["tbc"]);
        expect(pickedVersions({ g1: "all" }, [{ ...SERVERS[0], categories: [{ id: "x", name: "X", icon: "", versionId: "" }] }])).toBeNull();
    });

    it("says where in words", () => {
        expect(scopeLabel({ scope: [], categoryName: "" })).toBe(t("signups.availability.everywhere"));
        expect(scopeLabel({ categoryName: "📅 Kara" })).toBe("Kara");
        expect(scopeLabel({ categoryName: "", scope: [
            { guildId: "g1", name: "Pulse", categories: [{ id: "c1", name: "Kara" }, { id: "c2", name: "Forever" }] },
            { guildId: "g2", name: "PuGs", categories: [] },
        ] })).toBe(`Pulse · Kara, Forever / PuGs · ${t("signups.availability.dialog.allOfServer")}`);
    });

    it("fills a category the server sent without its name from the offered servers, never a bare known id", () => {
        const names = categoryNames([{ categories: [{ id: "c1", name: "📅 Kara" }, { id: "c2", name: "" }] }]);
        expect(names).toEqual({ c1: "📅 Kara" });
        const entry = { categoryName: "", scope: [{ guildId: "g1", name: "Pulse", categories: [{ id: "c1", name: "" }, { id: "c9", name: "" }] }] };
        expect(scopeLabel(entry, names)).toBe("Pulse · Kara, c9");
        expect(scopeLabel(entry)).toBe("Pulse · c1, c9");
    });
});

describe("the characters of an attendance", () => {
    const groups = characterGroups(CHARS, null);

    it("groups by version in the raider's order, only the versions picked", () => {
        expect(groups.map((g) => [g.versionId, g.characters.map((c) => c.key)])).toEqual([["tbc", ["one", "two"]], ["forever", ["fv"]]]);
        expect(characterGroups(CHARS, ["forever"]).map((g) => g.versionId)).toEqual(["forever"]);
    });

    it("picks the first character of an untouched version with its ready spec; an emptied version stays empty", () => {
        expect(effectiveChars({}, groups)).toEqual({ one: "one-b", fv: "fv-b" });
        expect(effectiveChars({ one: "", two: "" }, groups)).toEqual({ fv: "fv-b" });
        expect(effectiveChars({ two: "gone" }, groups)).toEqual({ two: "two-b", fv: "fv-b" });
    });

    it("toggles one row and keeps the rest of its version as shown", () => {
        const added = toggleChar({}, groups, CHARS[1]);
        expect(effectiveChars(added, groups)).toEqual({ one: "one-b", two: "two-b", fv: "fv-b" });
        const removed = toggleChar({}, groups, CHARS[0]);
        expect(effectiveChars(removed, groups)).toEqual({ fv: "fv-b" });
        expect(effectiveChars(setCharSpec({}, groups, "two", "two-a"), groups)).toEqual({ one: "one-b", two: "two-a", fv: "fv-b" });
    });

    it("reads an edited entry's characters by key or by name; an older one by its single character", () => {
        expect(charsFromEntry({ character: "", spec: "", characters: [{ character: "Two", spec: "two-a", versionId: "tbc", specLabel: "" }, { character: "gone", spec: "", versionId: "", specLabel: "" }] }, CHARS)).toEqual({ two: "two-a" });
        expect(charsFromEntry({ character: "one", spec: "nope" }, CHARS)).toEqual({ one: "one-b" });
        expect(charsFromEntry({ character: "", spec: "" }, CHARS)).toEqual({});
    });

    it("writes the body's characters in the raider's order, only those offered", () => {
        expect(charactersInput({ fv: "fv-a", one: "one-b", two: "" }, CHARS)).toEqual([{ character: "one", spec: "one-b" }, { character: "fv", spec: "fv-a" }]);
        expect(charactersInput({ fv: "fv-a" }, CHARS.slice(0, 2))).toEqual([]);
    });

    it("names an entry's characters with their spec", () => {
        expect(entryCharacters({ character: "", spec: "", characters: [{ character: "Zibbo", spec: "Priest-Holy", specLabel: "Holy" }, { character: "War", spec: "" }] }))
            .toEqual([`Zibbo · ${specLabel("Priest-Holy", "Holy")}`, "War"]);
        expect(entryCharacters({ character: "Old", spec: "", specLabel: "" })).toEqual(["Old"]);
        expect(entryCharacters({ character: "", spec: "" })).toEqual([]);
    });
});

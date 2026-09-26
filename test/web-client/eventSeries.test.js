// Wiederkehrende Events (#289) in the client: the rules behind the series page
// (src/web-client/src/lib/eventSeries.ts), run for real, and the page's shape
// checked on the source — one compact line per category, everything else in
// one modal that previews the next four dates with their channel names.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

function splitParams(list) {
    const out = [];
    let depth = 0;
    let cur = "";
    for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c === "=" && list[i + 1] === ">") { cur += "=>"; i++; continue; }
        if ("(<{[".includes(c)) depth++;
        if (")>}]".includes(c)) depth--;
        if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
        cur += c;
    }
    if (cur.trim()) out.push(cur);
    return out;
}

/** The lib without its TypeScript: `import type`, `export type` and one-line signatures only. */
function load() {
    const lines = read("lib", "eventSeries.ts").split("\n");
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^import type /.test(line)) continue;
        if (/^export type /.test(line)) continue;
        const fn = line.match(/^(export )?function (\w+)\((.*)\)(: .*)? \{$/);
        if (fn) {
            const params = splitParams(fn[3]).map((p) => p.trim().split(":")[0].replace("?", "").trim()).filter(Boolean);
            out.push(`function ${fn[2]}(${params.join(", ")}) {`);
            continue;
        }
        out.push(line.replace(/^export /, ""));
    }
    const js = out.join("\n");
    const names = [...js.matchAll(/^(?:function|const) (\w+)/gm)].map((m) => m[1]);
    return new Function(`${js}\nreturn { ${names.join(", ")} };`)();
}

const lib = load();
const ms = (iso) => Date.parse(iso);
const date = (over) => ({
    date: "2026-09-23", startTime: ms("2026-09-23T17:30:00Z") / 1000, createAt: ms("2026-09-17T17:30:00Z"), skipped: false,
    state: "planned", eventId: "", channelName: "", error: "", at: 0, attempts: 0, willRetry: false, ...over,
});

describe("the lines a date reads as", () => {
    it("names calendar days the German way", () => {
        expect(lib.dayLabel("2026-09-23")).toBe("Mi 23.09.");
        expect(lib.dayLabel("2026-10-25")).toBe("So 25.10.");
        expect(lib.momentDay(ms("2026-09-17T17:30:00Z"))).toBe("Do 17.09.");
        expect(lib.momentTime(ms("2026-09-17T17:30:00Z"))).toBe("19:30");
    });

    it("says when a date will be created and, afterwards, as what", () => {
        expect(lib.dateLine(date())).toBe("wird am Do 17.09. um 19:30 angelegt");
        expect(lib.dateLine(date({ state: "created", at: ms("2026-09-17T17:31:00Z"), channelName: "mi-23-09-ssc-tk" })))
            .toBe("angelegt am Do 17.09. 19:31 als #mi-23-09-ssc-tk");
        expect(lib.dateLine(date({ state: "cancelled" }))).toMatch(/nicht neu angelegt/);
        expect(lib.dateLine(date({ state: "skipped" }))).toMatch(/übersprungen/);
        expect(lib.dateLine(date({ state: "deleted" }))).toBe("Event gelöscht — wird nicht neu angelegt");
        expect(lib.dateLine(date({ state: "failed", error: "fehlende Rechte", willRetry: true }))).toBe("fehlgeschlagen: fehlende Rechte · neuer Versuch folgt");
        expect(lib.dateLine(date({ state: "existing", channelName: "mi-23" }))).toMatch(/gab es schon als #mi-23/);
    });

    it("gives every state a badge and a tone", () => {
        for (const s of ["planned", "due", "creating", "interrupted", "created", "existing", "cancelled", "deleted", "failed", "skipped", "off"]) {
            expect(lib.stateBadge(s).label).toBeTruthy();
        }
        expect(lib.stateBadge("deleted").label).toBe("gelöscht");
        expect(lib.stateBadge("failed").tone).toBe("bad");
        expect(lib.stateBadge("created").tone).toBe("ok");
    });

    it("names the next date the series still has to act on, and what it created last", () => {
        expect(lib.nextDate([date({ date: "a", state: "skipped" }), date({ date: "b" })]).date).toBe("b");
        expect(lib.nextDate([date({ date: "a", state: "created" }), date({ date: "b" })]).date).toBe("b");
        expect(lib.nextDate([date({ date: "a", state: "deleted" }), date({ date: "b" })]).date).toBe("b");
        expect(lib.nextDate([date({ date: "a", state: "skipped" }), date({ date: "b", state: "created" })]).date).toBe("b");
        expect(lib.nextDate([])).toBeNull();
        expect(lib.channelOf(date({ previewName: "mi-23" }))).toBe("mi-23");
        expect(lib.channelOf(date({ state: "failed", channelName: "real", previewName: "mi-23" }))).toBe("real");
        // a created date names its channel in its own line, not twice
        expect(lib.channelOf(date({ state: "created", channelName: "real" }))).toBe("");
        expect(lib.lastCreatedLine({ date: "2026-09-21", at: ms("2026-09-16T17:57:00Z"), channelName: "mo-21-09-ssc-tk" }))
            .toBe("zuletzt angelegt: Mo 21.09. als #mo-21-09-ssc-tk (am Mi 16.09.)");
        expect(lib.lastCreatedLine(null)).toBe("");
    });
});

describe("the modal's draft", () => {
    it("starts from the stored series or from Wednesday 19:30, 6 days before", () => {
        expect(lib.draftOf(null, "cat")).toEqual({ categoryId: "cat", enabled: true, weekdays: [3], time: "19:30", raidTemplateId: "", daysBefore: 6, title: "", skipDates: [] });
        const stored = { categoryId: "cat", enabled: false, weekdays: [3, 6], time: "20:00", raidTemplateId: "t", daysBefore: 4, title: "X", skipDates: ["2026-12-23"] };
        expect(lib.draftOf(stored, "cat")).toEqual(stored);
    });

    it("toggles weekdays and skipped dates, and becomes the preview query", () => {
        let d = lib.draftOf(null, "cat");
        d = lib.toggleWeekday(d, 6);
        d = lib.toggleWeekday(d, 1);
        expect(d.weekdays).toEqual([1, 3, 6]);
        d = lib.toggleSkip(d, "2026-09-23");
        expect(d.skipDates).toEqual(["2026-09-23"]);
        expect(lib.toggleSkip(d, "2026-09-23").skipDates).toEqual([]);
        const q = new URLSearchParams(lib.previewQuery(d));
        expect(Object.fromEntries(q)).toEqual({ category: "cat", weekdays: "1,3,6", time: "19:30", daysBefore: "6", template: "", skip: "2026-09-23", enabled: "1" });
    });
});

describe("the page", () => {
    const page = read("pages", "EventSeriesPage.tsx");

    it("is one line per category, with the summary and the next date, and a modal for the rest", () => {
        expect(page).toContain("data.categories.map((c) => (\n                            <SeriesRow");
        expect(page).toContain("{c.summary}");
        expect(page).toContain("Nächster Termin");
        expect(page).toContain("dateLine(next)");
        expect(page).toContain("useCollectionEditor(\"edit\")");
        // the row itself carries no form fields — they live in the modal
        const row = page.slice(page.indexOf("function SeriesRow"), page.indexOf("export default function"));
        expect(row).not.toMatch(/<input|<select/);
    });

    it("previews the next four dates with the channel each gets, and lets a date be skipped", () => {
        expect(page).toContain("Nächste 4 Termine");
        expect(page).toContain("previewEventSeries(query)");
        expect(page).toContain("<NamingBadge naming={o.naming} short />");
        expect(page).toContain("überspringen");
        expect(page).toContain("Erneut versuchen");
    });

    it("tells a Raid-Helper category why there is no series", () => {
        expect(page).toContain("Neue Events über Raid-Helper");
        expect(page).toContain("/settings?section=kategorien");
    });

    it("is routed, crumbed and linked from the Raid-Events head", () => {
        expect(read("App.tsx")).toContain("<Route path=\"raids/series\"");
        expect(read("components", "Shell.tsx")).toContain("if (pathname === \"/raids/series\") return tr(\"shell.crumb.series\");");
        expect(read("pages", "RaidsPage.tsx")).toContain("to=\"/raids/series\"");
        expect(read("api", "eventSeries.ts")).toContain("\"/api/raids/series\"");
    });
});

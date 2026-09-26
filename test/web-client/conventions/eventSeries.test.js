// Wiederkehrende Events (#289) in the client: the page's shape checked on the
// source — one compact line per category, everything else in one modal that
// previews the next four dates with their channel names. The rules
// (lib/eventSeries.ts) run in Vitest (src/web-client/src/lib/eventSeries.test.ts).
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");
const { dictionary } = require("../clientSource");

// The page's texts live in i18n/locales/<lang>/series.json: the source names
// the key, the German dictionary holds the words.
const de = dictionary("de");
const says = (src, key, text) => {
    expect(src).toContain(`t("${key}"`);
    expect(de[key]).toBe(text);
};

describe("the page", () => {
    const page = read("pages", "EventSeriesPage.tsx");

    it("is one line per category, with the summary and the next date, and a modal for the rest", () => {
        expect(page).toMatch(/data\.categories\.map\(\(c\) => \(\s*<SeriesRow/);
        expect(page).toContain("{c.summary}");
        says(page, "series.row.next", "Nächster Termin");
        expect(page).toContain("dateLine(next)");
        expect(page).toContain("useCollectionEditor(\"edit\")");
        // the row itself carries no form fields — they live in the modal
        const row = page.slice(page.indexOf("function SeriesRow"), page.indexOf("export default function"));
        expect(row).not.toMatch(/<input|<select/);
    });

    it("previews the next four dates with the channel each gets, and lets a date be skipped", () => {
        says(page, "series.modal.next", "Nächste 4 Termine");
        expect(page).toContain("previewEventSeries(query)");
        expect(page).toContain("<NamingBadge naming={o.naming} short />");
        says(page, "series.date.skip", "überspringen");
        says(page, "series.date.retry", "Erneut versuchen");
    });

    it("tells a Raid-Helper category why there is no series", () => {
        expect(page).toContain("t(\"series.row.raidHelperBefore\")");
        expect(de["series.row.raidHelperBefore"]).toContain("Neue Events über Raid-Helper");
        expect(page).toContain("/settings?section=kategorien");
    });

    it("is routed, crumbed and linked from the Raid-Events head", () => {
        expect(read("App.tsx")).toContain("<Route path=\"raids/series\"");
        expect(read("components", "Shell.tsx")).toContain("if (pathname === \"/raids/series\") return tr(\"shell.crumb.series\");");
        expect(read("pages", "RaidsPage.tsx")).toContain("to=\"/raids/series\"");
        expect(read("api", "eventSeries.ts")).toContain("\"/api/raids/series\"");
    });
});

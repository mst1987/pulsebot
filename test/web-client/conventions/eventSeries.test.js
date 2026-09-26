// Wiederkehrende Events (#289) in the client: the page's shape checked on the
// source — one compact line per category, everything else in one modal that
// previews the next four dates with their channel names. The rules
// (lib/eventSeries.ts) run in Vitest (src/web-client/src/lib/eventSeries.test.ts).
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

describe("the page", () => {
    const page = read("pages", "EventSeriesPage.tsx");

    it("is one line per category, with the summary and the next date, and a modal for the rest", () => {
        expect(page).toMatch(/data\.categories\.map\(\(c\) => \(\s*<SeriesRow/);
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

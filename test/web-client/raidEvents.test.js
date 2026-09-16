// Guards for the Raid-Events module (design issue #222): one list with a
// Kommend/Vergangen switch, the guided create dialog, the Aufruf-Vorlagen modal.
//
// The client is TSX and there is no React renderer here, so what is checked are
// the invariants that would regress silently. The content recognition and the
// raid size behind the icons and the signup bar are tested for real on the
// server side (test/web/raidListing.test.js).
const fs = require("fs");
const path = require("path");
const { CONTENTS } = require("../../src/config/tbcContent");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8");

const page = read("pages", "RaidsPage.tsx");
const list = read("components", "RaidList.tsx");
const dialog = read("components", "RaidCreateDialog.tsx");
const templates = read("pages", "RaidTemplatesPage.tsx");
const notify = read("pages", "NotifyTemplatesPage.tsx");
const createPage = read("pages", "RaidCreatePage.tsx");
const icons = read("lib", "raidIcons.ts");
const time = read("lib", "raidTime.ts");
const css = read("styles", "raid-events.css");

const MODULE_FILES = { page, list, dialog, templates, notify, createPage, icons, time, icon: read("components", "RaidIcon.tsx") };

describe("Raid-Events list", () => {
    it("keeps the open view in the url and remembers it", () => {
        expect(page).toContain("usePersistedSearchParam<View>(\"raids-view\", \"view\", \"upcoming\", VIEWS)");
        expect(page).toContain("const VIEWS = [\"upcoming\", \"past\"] as const;");
    });

    it("filters by category pills instead of one table per tab, remembered by id", () => {
        expect(page).toContain("usePersistedState(\"raids-category\", \"\")");
        expect(page).toContain("className={`re-pill");
        expect(page).not.toMatch(/tab-btn|role="tab"/);
        // a remembered category that is gone shows everything, not an empty list
        expect(page).toContain("const activeCategory = categoryId && pills.some((p) => p.id === categoryId) ? categoryId : null;");
    });

    it("loads the past raids from their own endpoint next to the coming ones", () => {
        expect(page).toContain("getRaids()");
        expect(page).toContain("getPastRaids()");
        expect(read("api.ts")).toContain("get<PastRaidsData>(\"/api/raids/past\")");
    });

    it("groups coming raids by week and past raids by month, after sorting by date", () => {
        expect(list).toContain("weekBands(apply(events, (ev) => ev.startTime || 0))");
        expect(list).toContain("monthBands(apply(events, (ev) => ev.startTime || 0))");
        // the week starts on Monday, in the guild's time zone
        expect(time).toContain("(new Date(day).getUTCDay() + 6) % 7");
        expect(time).toContain("const TZ = \"Europe/Berlin\";");
    });

    it("gives each list its own sort memory", () => {
        expect(list).toContain("useTableSort<SortKey>(\"raid-list-upcoming-sort\"");
        expect(list).toContain("useTableSort<SortKey>(\"raid-list-past-sort\"");
    });

    it("folds older months away and keeps the newest open", () => {
        expect(list).toContain("const isOpen = toggled[band.key] ?? band.key === newest;");
        expect(list).toContain("<Expand open={isOpen}");
    });

    it("measures signups as a bar against the raid size", () => {
        expect(list).toMatch(/<Bar value=\{ev\.signupCount\} max=\{ev\.raidSize\}/);
    });

    it("shows logs and loot as badges linking to where they are handled", () => {
        expect(list).toContain("to={detailHref(ev.id, \"logs\")}");
        expect(list).toContain("{pending.length} offen");
        expect(list).toContain("ausgewertet</Badge>");
        expect(list).toContain("to=\"/history?tab=import\"");
        // the log titles live in the tooltips, not as text lines in the cell
        expect(list).not.toContain("↗");
    });

    it("turns the row links into icon buttons with tooltips", () => {
        for (const icon of ["inv_letter_15", "inv_misc_groupneedmore", "inv_scroll_11", "spell_holy_borrowedtime"]) {
            expect(list).toContain(`"${icon}"`);
        }
        // "Wiederholen" replaces the per-category "＋ Event" and opens the dialog prefilled
        expect(page).toContain("navigate(`/raids/new?source=${encodeURIComponent(id)}`)");
    });
});

describe("raid icons", () => {
    it("has an icon for every content the server can recognise", () => {
        for (const c of CONTENTS) expect({ id: c.id, known: icons.includes(`    ${c.id}: { icon: "`) }).toEqual({ id: c.id, known: true });
    });

    it("uses the icon names that exist on the CDN", () => {
        // checked by download: Kael'thas only with the apostrophe, Archimonde only with the dash
        expect(icons).toContain("achievement_boss_kael'thassunstrider_01");
        expect(icons).toContain("\"achievement_boss_archimonde-\"");
        expect(icons).toContain("export const RAID_ICON_FALLBACK = \"inv_misc_note_02\";");
    });
});

describe("Neues Event dialog", () => {
    it("is a dialog over the list, not a page of its own", () => {
        expect(createPage).toContain("return <RaidsPage />;");
        expect(page).toContain("location.pathname.replace(/\\/+$/, \"\") === \"/raids/new\"");
        expect(page).toContain("<RaidCreateDialog");
    });

    it("walks through its steps and opens a ?source link past the start step", () => {
        // the steps themselves (and the planning step, #261) are in eventCreateDialog.test.js
        expect(dialog).toContain("const steps = stepsFor(editing, source);");
        expect(dialog).toMatch(/applyChoice\(data, \{ kind: "event", id: sourceId \}\);\s+setStep\("termin"\);/);
    });

    it("explains fields in tooltips instead of hint paragraphs", () => {
        expect(dialog).not.toContain("className=\"hint\"");
        expect(dialog).toContain("data-tip-sub={tip}");
    });

    it("reports the result as a toast and closes instead of navigating to another page", () => {
        expect(dialog).toContain("else toast(\"Event angelegt.\");");
        expect(dialog).toContain("onCreated();");
        expect(dialog).not.toContain("useNavigate");
    });

    it("offers the raid templates that link a Raid-Helper template, preselecting the category default", () => {
        // the old management dialog is the Raid-Vorlagen page now (#266)
        expect(dialog).not.toContain("RaidTemplatesDialog");
        expect(dialog).toContain("<Link className=\"re-link\" to=\"/raids/raid-templates\">Raid-Vorlagen</Link>");
        expect(dialog).toContain("value={t.raidhelperTemplateId}");
        expect(dialog).toContain("(data.categoryTemplates || {})[ev.categoryId]");
        expect(dialog).toContain("setTemplateId((data.categoryTemplates || {})[catId] || data.defaults.templateId || \"\")");
        expect(templates).toContain("importRaidTemplates(csrfToken)");
    });
});

describe("Aufruf-Vorlagen", () => {
    it("drops the back link above the title — the breadcrumb is the way back", () => {
        expect(notify).not.toContain("Zurück zur Event-Übersicht");
    });

    it("previews the Discord message next to the fields and flags a draft", () => {
        expect(notify).toContain("<DiscordPreview title={title} body={body} />");
        expect(notify).toContain("{dirty && <Badge tone=\"mid\"");
    });

    it("renders markdown as React nodes, never as injected HTML", () => {
        expect(notify).not.toContain("dangerouslySetInnerHTML");
    });
});

describe("module hygiene", () => {
    it("uses no native title tooltips and no emoji as icons", () => {
        for (const [name, src] of Object.entries(MODULE_FILES)) {
            expect({ name, title: /<(span|div|a|button|label|input|img|li|svg)\b[^>]*\stitle=/.test(src) }).toEqual({ name, title: false });
            expect({ name, emoji: /[＋\u{1F300}-\u{1FAFF}]/u.test(src) }).toEqual({ name, emoji: false });
        }
    });

    it("styles the module in its own stylesheet, without gold", () => {
        expect(page).toContain("import \"../styles/raid-events.css\";");
        expect(notify).toContain("import \"../styles/raid-events.css\";");
        expect(css).not.toMatch(/:\s*gold\b|goldenrod|#d4af37|#ffd700/i);
        expect(read("index.css")).not.toContain(".re-row");
    });
});

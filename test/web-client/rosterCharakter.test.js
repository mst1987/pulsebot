// Guards for the roster and the character page (design issue #218). Source
// scans, like the other client tests: the client is TypeScript and these run
// plain Node, so the invariants worth protecting are held on the source text.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
// LF regardless of the checkout: git's autocrlf hands Windows the files with CRLF, and the patterns below match on \n
const read = (...p) => fs.readFileSync(path.join(CLIENT, ...p), "utf8").replace(/\r\n/g, "\n");

const roster = read("pages", "RosterPage.tsx");
const charPage = read("pages", "HistoryCharPage.tsx");
const common = read("components", "RosterCommon.tsx");
const kpis = read("components", "RosterHero.tsx");
const view = read("lib", "rosterView.ts");
const css = read("styles", "roster-charakter.css");
const indexCss = read("index.css");
const FILES = { roster, charPage, common, kpis, view };

describe("roster & character page: shared rules", () => {
    it.each(Object.keys(FILES))("%s uses no native title tooltip and no text glyph icons", (name) => {
        const src = FILES[name];
        // `title` as a component prop (PartHead, Modal) is fine; on a DOM element it is the native box.
        expect(src).not.toMatch(/<(a|span|div|button|img|td|th|label|i|b)\b[^>]*\stitle=/);
        expect(src).not.toMatch(/[✓✕↻↗←]/);
        expect(src).not.toMatch(/lbadge/);
    });

    it("keeps its styles in its own stylesheet, imported by both pages", () => {
        expect(roster).toContain('import "../styles/roster-charakter.css";');
        expect(charPage).toContain('import "../styles/roster-charakter.css";');
        // the replaced hero band, gear-issue cards and gear rows are gone from index.css
        for (const cls of [".stat-hero", ".stat-tile", ".gi-row", ".gear-row", ".char-hero"]) {
            expect(indexCss).not.toContain(cls);
        }
    });

    it("builds on the shared building blocks", () => {
        expect(roster).toMatch(/from "\.\.\/components\/ui"/);
        expect(charPage).toMatch(/from "\.\.\/components\/ui"/);
        expect(charPage).toContain("<Modal");
        expect(charPage).toContain("<PartHead");
        expect(roster).toContain("<Segment<RoleFilter>");
        expect(roster).toContain("<Expand");
    });
});

describe("roster page", () => {
    it("dropped the explanatory paragraph, the category and class selects and the reset button", () => {
        expect(roster).not.toContain('className="note"');
        expect(roster).not.toContain("<select");
        expect(roster).not.toContain("Filter zurücksetzen");
        expect(roster).not.toContain('type="checkbox"');
    });

    it("persists a view without category/classSpec/sort, with role, and validates what it reads", () => {
        expect(roster).toMatch(/type View = \{ search: string; role: RoleFilter; className: string; onlyIssues: boolean; open: string\[\] \| null \};/);
        expect(roster).toContain('usePersistedState<View>("roster-view", VIEW_DEFAULT)');
        expect(roster).toContain('ROLE_FILTERS.includes(stored.role) ? stored.role : "all"');
    });

    it("makes the gear-problem KPI the filter switch", () => {
        expect(kpis).toMatch(/label="Gear-Probleme"[\s\S]*?onClick=\{onToggleIssues\}/);
        expect(kpis).toContain("aria-pressed={active}");
    });

    it("shows WCL and Armory as icon links with a tooltip instead of text buttons", () => {
        expect(roster).not.toMatch(/WCL ↗|Armory ↗/);
        expect(roster).toContain('icon="inv_misc_pocketwatch_01" tip="Warcraft Logs"');
        expect(roster).toContain('icon="inv_shirt_guildtabard_01" tip="Armory"');
        expect(common).toMatch(/aria-label=\{tip\}\s*data-tip=\{tip\}/);
    });

    it("draws attendance as a fixed-width bar toned ok ≥ 80 / mid ≥ 60 / bad", () => {
        expect(css).toMatch(/\.bar\.rc-bar \{ width: 188px;/);
        expect(view).toMatch(/if \(pct >= 80\) return "ok";\s*if \(pct >= 60\) return "mid";\s*return "bad";/);
    });

    it("shows eleven rows per group before offering the rest", () => {
        expect(roster).toContain("const GROUP_PREVIEW = 11;");
        expect(roster).toContain("weitere zeigen");
    });
});

describe("character page", () => {
    it("has the three sections behind a remembered switch", () => {
        expect(charPage).toContain('usePersistedSearchParam<CharTab>("history-char-tab", "tab", "gear", CHAR_TABS)');
        expect(charPage).toContain('const CHAR_TABS: CharTab[] = ["gear", "loot", "attendance"];');
        expect(charPage).not.toContain('className="tabs"');
    });

    it("puts findings on the slot rows instead of a separate card, and leaves out shirt and tabard", () => {
        expect(charPage).not.toContain("GearIssuesCard");
        expect(charPage).toContain('const NO_RAID_VALUE = new Set(["SHIRT", "TABARD"]);');
        expect(charPage).not.toMatch(/const GEAR_LEFT = \[[^\]]*"SHIRT"/);
        expect(charPage).toContain("findingsForSlot(issues, slot, bySlot.get(slot))");
    });

    it("opens item details in a modal addressed by the url", () => {
        expect(charPage).toContain('const itemSlot = searchParams.get("item") || "";');
        expect(charPage).toContain("<ItemDetailModal");
    });

    it("dropped the back link and the meta row", () => {
        expect(charPage).not.toContain("Zurück zum Roster");
        expect(charPage).not.toContain("hero-meta");
        expect(charPage).not.toContain("Profile-Namespace</dt>");
    });

    it("keeps the loot history deletable only with write access (the table asks first)", () => {
        expect(charPage).toContain('const canEdit = canAccess(user, "history", "write");');
        expect(charPage).toContain("onDelete={canEdit ? removeItem : undefined}");
    });
});

describe("rosterView helpers (mirrored logic)", () => {
    it("matches findings by item first and by slot key for an empty slot", () => {
        const fn = view.match(/export function findingsForSlot[\s\S]*?\n}\n/)[0];
        expect(fn).toContain("if (itemId && i.itemId) return i.itemId === itemId;");
        expect(fn).toContain("return !!i.slotKey && i.slotKey === slot;");
    });
});

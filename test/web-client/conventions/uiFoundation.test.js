// Client-wide rules around the shared building blocks of the admin menu
// (src/web-client/src/components/ui, design issue #221) — what a render of one
// component cannot show:
//   * an IconButton cannot be declared without its tooltip,
//   * the shell draws its controls with the blocks, and glyphs gave way to icons,
//   * no page asks through the browser's confirm() any more,
//   * no element carries a native `title` any more — the tooltip box does,
//   * one tooltip layer for the whole menu,
//   * the blocks' CSS (own .itile, no gold, the popover's centring undone).
// How the blocks behave is tested in Vitest next to them
// (components/ui/*.test.tsx, lib/confirmIncomplete.test.ts).
const fs = require("fs");
const path = require("path");
const { CLIENT, read } = require("../clientSource");

const css = read("index.css");

/** Every .ts/.tsx file of the client (tests excluded), as [relative name, source]. */
function clientSources() {
    const out = [];
    (function walk(dir) {
        for (const file of fs.readdirSync(dir)) {
            const full = path.join(dir, file);
            if (fs.statSync(full).isDirectory()) walk(full);
            else if (/\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file)) out.push([path.relative(CLIENT, full).replace(/\\/g, "/"), fs.readFileSync(full, "utf8")]);
        }
    })(CLIENT);
    return out;
}

/**
 * The opening tags of intrinsic (lower-case) JSX elements plus react-router's
 * <Link>, with their attribute text — braces are balanced so an arrow function
 * inside an attribute does not end the tag early.
 */
function intrinsicTags(src) {
    return openingTags(src, /<([a-z][a-zA-Z0-9]*|Link)(?=[\s/>])/g);
}

/** The opening tags `re` finds (group 1 = the tag name), attributes brace-balanced. */
function openingTags(src, re) {
    const tags = [];
    let m;
    while ((m = re.exec(src))) {
        let depth = 0;
        let quote = null;
        let i = m.index + m[0].length;
        for (; i < src.length; i++) {
            const c = src[i];
            if (quote) { if (c === quote && src[i - 1] !== "\\") quote = null; continue; }
            if (c === "\"" || c === "'" || c === "`") { quote = c; continue; }
            if (c === "{") depth++;
            else if (c === "}") depth--;
            else if (c === ">" && depth === 0) break;
        }
        tags.push({ tag: m[1], attrs: src.slice(m.index + m[0].length, i) });
    }
    return tags;
}

describe("building blocks", () => {
    it("requires a tooltip on every icon button, and leaves no room for a native title", () => {
        const src = read("components/ui/Button.tsx");
        const props = src.match(/export function IconButton\([\s\S]*?\}\) \{/)[0];
        // required (no "?") — so the type checker refuses an IconButton without one
        expect(props).toMatch(/\n\s+tip: string;/);
        expect(props).toContain("Omit<NativeButton, \"title\">");
    });

    it("draws the shell's controls with the shared blocks", () => {
        const shell = read("components/Shell.tsx");
        expect(shell).toContain("<TipLayer />");
        expect(shell).toContain("<IconButton className=\"menu-toggle\"");
        expect(read("components/ThemeToggle.tsx")).toContain("<IconButton");
        expect(read("components/Pager.tsx")).toMatch(/<IconButton size="sm" icon=\{<ChevronLeftIcon \/>\}/);
        const guild = read("components/GuildSwitcher.tsx");
        expect(guild).toContain("const GUILD_ICON = \"inv_misc_tabardpvp_01\";");
        expect(guild).not.toContain("← bitte zuerst einen Server wählen");
        expect(guild).toMatch(/<Badge tone="mid"[^>]*>\s*\{t\("shell.guild.notChosen"\)\}/);
    });

    it("swaps the glyphs of pager, sort header and toast for icons", () => {
        expect(read("components/Pager.tsx")).not.toMatch(/‹ Zurück|Weiter ›/);
        const sort = read("components/SortTh.tsx");
        expect(sort).not.toMatch(/▲|▼/);
        expect(sort).toContain("<ChevronDownIcon />");
        expect(sort).toMatch(/\n\s+tip\?: string;/);
        const jobs = read("components/Jobs.tsx");
        expect(jobs).not.toMatch(/"✓"|"!"|&times;/);
        expect(jobs).toMatch(/icon\?: string;/);
        expect(jobs).toContain("<WowIcon name={job.icon} size={32} />");
    });

    it("keeps the icon tile's style off the dashboard's .tile", () => {
        expect(css).toMatch(/\n\.itile \{/);
        // the dashboard tile is still there and untouched by the new block
        expect(css).toMatch(/\n\.tile \{ background: var\(--panel\)/);
    });

    it("styles every block in index.css, without gold", () => {
        for (const cls of [".wi ", ".ibtn ", ".split ", ".seg ", ".seg-opt ", ".badge ", ".itile ", ".exp ", ".exp-lbl ", ".bar ", ".page-head ", ".part-head ", ".tip ", "dialog.dlg ", ".dlg-head ", ".dlg-foot "]) {
            expect({ cls, styled: new RegExp(`\\n${cls.replace(/[.*]/g, "\\$&")}\\{`).test(css) }).toEqual({ cls, styled: true });
        }
        const block = css.slice(css.indexOf("Shared building blocks (components/ui"));
        expect(block).not.toMatch(/:\s*gold\b|goldenrod|#d4af37|#ffd700|#c9a227|#e6b422/i);
    });

    it("gives the table head the report pages' tinted mono look", () => {
        const th = css.match(/\ntable\.idx th \{[^}]+\}/)[0];
        expect(th).toContain("background: var(--panel2)");
        expect(th).toContain("font-family: var(--font-mono)");
        expect(th).toContain("text-transform: uppercase");
    });
});

describe("confirm dialog instead of window.confirm", () => {
    it("leaves no native confirm() anywhere in the client", () => {
        const offenders = clientSources()
            .filter(([, src]) => /(^|[^\w.])confirm\(|window\.confirm/.test(src))
            .map(([name]) => name);
        expect(offenders).toEqual([]);
    });

    it("sits above the router, so a running job can still ask", () => {
        expect(read("App.tsx")).toMatch(/<JobsProvider>\s*<ConfirmProvider>\s*<Routes>/);
    });
});

describe("tooltips instead of native title", () => {
    it("leaves no title attribute on any element of the client", () => {
        const offenders = [];
        for (const [name, src] of clientSources()) {
            if (!name.endsWith(".tsx")) continue;
            for (const { tag, attrs } of intrinsicTags(src)) {
                if (tag === "svg") continue;
                if (/(^|\s)title=/.test(attrs)) offenders.push(`${name}: <${tag}${attrs.slice(0, 60)}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it("finds the tags it scans at all", () => {
        // Sanity: a broken tag scanner would make the test above vacuous.
        // The loot council page is split over pages/lootcouncil/ (#223) — scanned together.
        const council = clientSources()
            .filter(([name]) => name.startsWith("pages/lootcouncil/"))
            .map(([, src]) => src).join("\n");
        const tags = intrinsicTags(council);
        expect(tags.length).toBeGreaterThan(300);
        // Most of its tooltips go through the Badge/Button `tip` props now, so
        // fewer raw data-tip attributes are left to find.
        expect(tags.filter((t) => /data-tip=/.test(t.attrs)).length).toBeGreaterThan(25);
    });
});

describe("tooltips and modal dialogs", () => {
    it("undoes the popover's centring, so left/top still place the box", () => {
        const rule = css.match(/\n\.tip \{[^}]+\}/)[0];
        for (const decl of ["position: fixed", "right: auto", "bottom: auto", "margin: 0", "overflow: visible"]) {
            expect({ decl, set: rule.includes(decl) }).toEqual({ decl, set: true });
        }
    });

    it("leaves no module its own tooltip layer or focus workaround", () => {
        const sources = Object.fromEntries(clientSources());
        const layers = Object.entries(sources)
            .filter(([name, src]) => name !== "components/Shell.tsx" && name !== "components/ui/Tip.tsx" && /<TipLayer\s*\/>/.test(src))
            .map(([name]) => name);
        expect(layers).toEqual([]);
        for (const name of ["components/ItemAwardsDialog.tsx", "components/LootInboxTab.tsx", "components/ManualLootForm.tsx", "pages/recruitment/Editors.tsx", "pages/recruitment/PostDialog.tsx", "pages/recruitment/ApplicationsTab.tsx"]) {
            expect({ name, footFocus: /initialFocus="\.dlg-foot/.test(sources[name]) }).toEqual({ name, footFocus: false });
        }
    });
});

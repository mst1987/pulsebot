// Guards for the shared building blocks of the admin menu
// (src/web-client/src/components/ui, design issue #221).
//
// The client is TSX and this project has no React test renderer, so what is
// checked are the invariants that break silently:
//   * every building block exists and exports what the module pages import,
//   * an IconButton cannot be written without its tooltip,
//   * no page asks through the browser's confirm() any more, and the confirm
//     dialog resolves the way callers rely on (only the action says yes),
//   * no element carries a native `title` any more — the tooltip box does,
//   * the WoW icon url encodes what encodeURIComponent leaves alone,
//   * the icon tile does not collide with the dashboard's `.tile`.
const fs = require("fs");
const path = require("path");
const { wowIconUrl, FALLBACK_ICON } = require("../../src/config/menu");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8");
const css = read("index.css");

/** Every .ts/.tsx file of the client, as [relative name, source]. */
function clientSources() {
    const out = [];
    (function walk(dir) {
        for (const file of fs.readdirSync(dir)) {
            const full = path.join(dir, file);
            if (fs.statSync(full).isDirectory()) walk(full);
            else if (/\.tsx?$/.test(file)) out.push([path.relative(CLIENT, full).replace(/\\/g, "/"), fs.readFileSync(full, "utf8")]);
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
    const BLOCKS = {
        "WowIcon.tsx": ["export default function WowIcon("],
        "Button.tsx": ["export function Button(", "export function IconButton(", "export function SplitButton(", "export type ButtonVariant = \"primary\" | \"ghost\" | \"run\" | \"danger\";"],
        "Segment.tsx": ["export default function Segment<"],
        "Badge.tsx": ["export default function Badge(", "export type Tone = \"ok\" | \"mid\" | \"bad\" | \"accent\";"],
        "IconTile.tsx": ["export default function IconTile("],
        "Expand.tsx": ["export default function Expand("],
        "Bar.tsx": ["export default function Bar("],
        "PageHead.tsx": ["export default function PageHead("],
        "PartHead.tsx": ["export function PartHead(", "export const SectionHead = PartHead;"],
        "Tip.tsx": ["export default function Tip(", "export function TipLayer("],
        "Modal.tsx": ["export function Modal(", "export function useConfirm(", "export function ConfirmProvider("],
    };

    it.each(Object.entries(BLOCKS))("ships %s", (file, exports) => {
        const src = read("components", "ui", file);
        for (const e of exports) expect(src).toContain(e);
    });

    it("re-exports every block from one index", () => {
        const index = read("components", "ui", "index.ts");
        for (const file of Object.keys(BLOCKS)) expect(index).toContain(`"./${file.replace(".tsx", "")}"`);
    });

    it("requires a tooltip on every icon button", () => {
        const src = read("components", "ui", "Button.tsx");
        const props = src.match(/export function IconButton\([\s\S]*?\}\) \{/)[0];
        // required (no "?"), and a native title cannot sneak in beside it
        expect(props).toMatch(/\n\s+tip: string;/);
        expect(props).toContain("Omit<NativeButton, \"title\">");
        // the tip is also what a screen reader announces
        expect(src).toContain("aria-label={rest[\"aria-label\"] || tip}");
        // and every use in the client passes one
        for (const [name, source] of clientSources()) {
            for (const { attrs } of openingTags(source, /<(IconButton)(?=[\s/>])/g)) {
                expect({ name, hasTip: /\stip=/.test(attrs) }).toEqual({ name, hasTip: true });
            }
        }
    });

    it("draws the shell's controls with the shared blocks", () => {
        const shell = read("components", "Shell.tsx");
        expect(shell).toContain("<TipLayer />");
        expect(shell).toContain("<IconButton className=\"menu-toggle\"");
        expect(read("components", "ThemeToggle.tsx")).toContain("<IconButton");
        expect(read("components", "Pager.tsx")).toMatch(/<IconButton size="sm" icon=\{<ChevronLeftIcon \/>\}/);
        const guild = read("components", "GuildSwitcher.tsx");
        expect(guild).toContain("const GUILD_ICON = \"inv_misc_tabardpvp_01\";");
        expect(guild).not.toContain("← bitte zuerst einen Server wählen");
        expect(guild).toMatch(/<Badge tone="mid"[^>]*>\s*Kein Server gewählt/);
    });

    it("swaps the glyphs of pager, sort header and toast for icons", () => {
        expect(read("components", "Pager.tsx")).not.toMatch(/‹ Zurück|Weiter ›/);
        const sort = read("components", "SortTh.tsx");
        expect(sort).not.toMatch(/▲|▼/);
        expect(sort).toContain("<ChevronDownIcon />");
        expect(sort).toMatch(/\n\s+tip\?: string;/);
        const jobs = read("components", "Jobs.tsx");
        expect(jobs).not.toMatch(/"✓"|"!"|&times;/);
        expect(jobs).toMatch(/icon\?: string;/);
        expect(jobs).toContain("<WowIcon name={job.icon} size={32} />");
    });

    it("keeps the icon tile off the dashboard's .tile", () => {
        expect(read("components", "ui", "IconTile.tsx")).toContain("\"itile\"");
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

    it("asks through useConfirm in every place that used to call confirm()", () => {
        const places = {
            "pages/ClaPage.tsx": 5,
            "pages/RaidDetailPage.tsx": 3,
            "pages/SettingsPage.tsx": 2,
            "pages/RecruitmentPage.tsx": 2,
            "pages/HistoryPage.tsx": 1,
            "pages/HistoryEventPage.tsx": 1,
            "pages/NotifyTemplatesPage.tsx": 1,
            "pages/RaidCreatePage.tsx": 1,
            "components/LootInboxTab.tsx": 1,
            "components/LootTable.tsx": 1,
        };
        const sources = Object.fromEntries(clientSources());
        for (const [name, count] of Object.entries(places)) {
            const asks = sources[name].match(/if \(!\(await ask\(\{ title: /g) || [];
            expect({ name, asks: asks.length }).toEqual({ name, asks: count });
            expect(sources[name]).toContain("const ask = useConfirm();");
        }
    });

    it("turns the unfinished-raid refusal into the dialog", () => {
        const lib = read("lib", "confirmIncomplete.ts");
        expect(lib).toContain("export async function withIncompleteConfirm<T>(ask: ConfirmFn, run: (force: boolean) => Promise<T>)");
        expect(lib).toContain("title: \"Raid nicht beendet\"");
        expect(lib).toContain("action: \"Trotzdem auswerten\"");
        for (const [name, src] of clientSources()) {
            for (const [call] of src.matchAll(/withIncompleteConfirm\([^,)]*/g)) {
                if (name === "lib/confirmIncomplete.ts") continue;
                expect({ name, call }).toEqual({ name, call: "withIncompleteConfirm(ask" });
            }
        }
    });

    it("resolves true only on the action — Esc, backdrop, close and Abbrechen say no", () => {
        const modal = read("components", "ui", "Modal.tsx");
        // Esc fires the dialog's cancel event, which goes to onClose...
        expect(modal).toContain("onCancel={(e) => { e.preventDefault(); onClose(); }}");
        // ...as does a click on the backdrop,
        expect(modal).toContain("onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}");
        // and the confirm dialog's onClose, like "Abbrechen", answers false.
        expect(modal).toContain("onClose={() => answer(false)}");
        expect(modal).toMatch(/data-confirm-cancel="" onClick=\{\(\) => answer\(false\)\}/);
        expect((modal.match(/answer\(true\)/g) || []).length).toBe(1);
        // The destructive button is never preselected: the focus goes to Abbrechen.
        expect(modal).toContain("initialFocus=\"[data-confirm-cancel]\"");
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
        const tags = intrinsicTags(read("pages", "LootCouncilPage.tsx"));
        expect(tags.length).toBeGreaterThan(300);
        expect(tags.filter((t) => /data-tip=/.test(t.attrs)).length).toBeGreaterThan(50);
    });

    it("draws one box for every data-tip, on hover, focus and tap", () => {
        const tip = read("components", "ui", "Tip.tsx");
        for (const ev of ["\"mouseover\"", "\"focusin\"", "\"pointerdown\""]) expect(tip).toContain(`document.addEventListener(${ev}`);
        expect(tip).toContain("closest(\"[data-tip]\")");
        expect(tip).toContain("getAttribute(\"data-tip-sub\")");
        // text only — a tooltip string never becomes markup
        expect(tip).not.toContain("innerHTML");
    });
});

describe("WoW icon url", () => {
    it("builds the zamimg url, large by default and medium for small icons", () => {
        expect(wowIconUrl("inv_misc_map_01")).toBe("https://wow.zamimg.com/images/wow/icons/large/inv_misc_map_01.jpg");
        expect(wowIconUrl("inv_misc_map_01", 18)).toBe("https://wow.zamimg.com/images/wow/icons/medium/inv_misc_map_01.jpg");
    });

    it("encodes the apostrophe that encodeURIComponent leaves alone", () => {
        expect(wowIconUrl("achievement_boss_kael'thassunstrider_01"))
            .toBe("https://wow.zamimg.com/images/wow/icons/large/achievement_boss_kael%27thassunstrider_01.jpg");
    });

    it("keeps a trailing suffix some names only exist with", () => {
        expect(wowIconUrl("achievement_boss_archimonde-")).toMatch(/\/achievement_boss_archimonde-\.jpg$/);
    });

    it("normalises case and a pasted .jpg, and falls back to the question mark", () => {
        expect(wowIconUrl("INV_Misc_Bag_10.jpg")).toMatch(/\/inv_misc_bag_10\.jpg$/);
        expect(wowIconUrl("")).toMatch(new RegExp(`/${FALLBACK_ICON}\\.jpg$`));
        expect(wowIconUrl(undefined)).toMatch(new RegExp(`/${FALLBACK_ICON}\\.jpg$`));
    });

    it("has a client twin that follows exactly the same rules", () => {
        const body = (src) => src.match(/const clean = [^\n]+\n[^\n]+\n[^\n]+/)[0].replace(/\s+/g, " ");
        const cjs = fs.readFileSync(path.join(__dirname, "..", "..", "src", "config", "menu.js"), "utf8");
        expect(body(read("lib", "wowIcon.ts"))).toBe(body(cjs));
        expect(read("components", "ui", "WowIcon.tsx")).toContain("wowIconUrl(failed ? FALLBACK_ICON : name, size)");
    });
});

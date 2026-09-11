// Guards for the loot council's gear sources and the tidied raider actions
// (src/web-client/src/pages/LootCouncilPage.tsx + index.css + api.ts).
//
// Three things changed together, and each has an invariant worth holding:
//   * where the gear comes from is one split pill in the gear band —
//     Auswertung · Log · Armory — next to the gear it describes, not among
//     the raider's actions in the head; "Log" opens a panel at that raider,
//     "Auswertung" is the way back from a loaded log or the armory;
//   * the head keeps only what is about the raider: the role switch and two
//     icon buttons (Sim-Export, Nicht einplanen) with their names as tooltips;
//   * a worn item's icon is a Wowhead link carrying the raider's gems and
//     enchant, so the widget tooltip shows the piece as worn — the page's own
//     hover panel with a handful of stats is gone.
// There is no React test renderer in this project, so the checks are on the
// source.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");
const page = read("pages", "LootCouncilPage.tsx");
const css = read("index.css");
const api = read("api.ts");

/** The body of one top-level function in the page source. */
function fn(name) {
    const m = page.match(new RegExp(`\\nfunction ${name}\\b[\\s\\S]*?\\n}\\n`));
    if (!m) throw new Error(`function ${name} not found`);
    return m[0];
}

/** One CSS rule's declarations. */
function rule(selector) {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`));
    if (!m) throw new Error(`rule ${selector} not found`);
    return m[1];
}

describe("loot council — the gear source pill", () => {
    it("sits in the gear band, with the three sources as one element", () => {
        const band = fn("GearBand");
        expect(band).toMatch(/<span className="lc-gearsrc" role="group"/);
        for (const label of ["Auswertung", "Log", "Armory"]) expect(band).toContain(label);
        // Same anatomy as the role switch: a pill of segments, the active one filled.
        expect(rule(".lc-gearsrc")).toMatch(/border-radius: 999px/);
        expect(rule(".lc-srcopt.active")).toMatch(/var\(--accent\)/);
        // The armory segment keeps the armory's cyan, like its link.
        expect(css).toMatch(/\.lc-srcopt\.active\.lc-srcopt-armory \{[^}]*var\(--accent-2\)/);
    });

    it("offers the sources even when no source has gear yet", () => {
        // That is exactly when somebody wants to load a log.
        const band = fn("GearBand");
        expect(band).toMatch(/Kein Gear bekannt[\s\S]*?\{sourcePill\}/);
    });

    it("marks a loaded log as the active source and says so in the stamp", () => {
        expect(page).toMatch(/className=\{`lc-srcopt\$\{source === "wcl" \|\| logOpen \? " active" : ""\}`\}/);
        const stamp = fn("GearStamp");
        expect(stamp).toMatch(/g\.source === "wcl"/);
        expect(stamp).toMatch(/<span className="lc-gear-wcl">Log<\/span>/);
        // ...and why a loaded log was *not* taken.
        expect(stamp).toMatch(/g\.logRejected === "pvp"/);
        expect(stamp).toMatch(/g\.logRejected === "role"/);
        expect(api).toMatch(/source: "log" \| "wcl" \| "armory";/);
        expect(api).toMatch(/logRejected: "" \| "pvp" \| "role";/);
    });

    it("has a way back to the evaluation's set", () => {
        const band = fn("GearBand");
        expect(band).toMatch(/onClick=\{\(\) => onEvaluation\(raider\.character\)\}/);
        expect(page).toMatch(/loadCouncilLogGear\(csrfToken, \{ character, clear: true \}\)/);
    });
});

describe("loot council — the log panel", () => {
    it("opens at the raider, one at a time, like the sim export", () => {
        expect(page).toMatch(/const \[logPanelFor, setLogPanelFor\] = useState\(""\);/);
        expect(page).toMatch(/logOpen=\{logPanelFor === r\.character\}/);
        const block = fn("RaiderBlock");
        expect(block).toMatch(/\{logOpen \? <LogPanel raider=\{r\} logs=\{logs\} busy=\{busy\} onLoad=\{onLogLoad\} onClose=\{\(\) => onLogToggle\(r\.character\)\} \/> : null\}/);
    });

    it("offers the bot's newest logs, the newest one with the raider, and a link", () => {
        const panel = fn("LogPanel");
        expect(panel).toMatch(/logs\.map\(\(log\) =>/);
        expect(panel).toMatch(/onLoad\(raider\.character, \{ reportId: log\.reportId \}\)/);
        expect(panel).toMatch(/onLoad\(raider\.character, \{\}\)/);
        expect(panel).toMatch(/onLoad\(raider\.character, \{ link: value \}\)/);
        // The logs come with the council payload — no second request per raider.
        expect(api).toMatch(/recentLogs: CouncilLog\[\];/);
        expect(page).toMatch(/logs=\{data\.recentLogs \|\| \[\]\}/);
    });

    it("loads as a job, reloads, and reports a refused set", () => {
        const src = page;
        expect(src).toMatch(/label: "Log wird geladen"[\s\S]{0,200}loadCouncilLogGear\(csrfToken, \{ character, \.\.\.pick \}\)/);
        expect(src).toMatch(/const fresh = await reloadAll\(\);[\s\S]{0,400}logRejected === "pvp"/);
        expect(api).toMatch(/send\("POST", "\/api\/lootcouncil\/loggear", csrfToken, body\)/);
        // Its own busy key, so the armory spinner and the log spinner never share.
        expect(src).toMatch(/runFor\(`loggear:\$\{character\}`/);
    });
});

describe("loot council — the tidied raider head", () => {
    it("keeps only the role switch and two icon buttons in the head", () => {
        const block = fn("RaiderBlock");
        expect(block).toMatch(/className="lc-ibtn"[\s\S]{0,200}aria-label="Sim-Export"/);
        expect(block).toMatch(/className="lc-ibtn lc-ibtn-danger"[\s\S]{0,200}aria-label="Nicht einplanen"/);
        // The text buttons are gone from the head; the armory moved into the band.
        expect(block).not.toContain("Armory laden");
        expect(block).not.toContain("btn-armory-link");
        expect(block).not.toMatch(/>\s*Sim-Export\s*</);
        expect(block).toMatch(/onArmory=\{onArmory\}/);
        // Both actions still guard against a double click.
        expect(block).toContain("disabled={busy.has(`export:${r.character}`)}");
        expect(block).toContain("disabled={busy.has(`exclude:${r.character}`)}");
    });

    it("keeps the armory link in the band, next to the stamp", () => {
        const band = fn("GearBand");
        expect(band).toMatch(/className="lc-ibtn lc-ibtn-link"[\s\S]{0,120}href=\{raider\.armoryUrl\}/);
        expect(band).toMatch(/\{sourcePill\}\s*<span className="lc-gear-seen sub"><GearStamp raider=\{raider\} \/><\/span>\s*\{armoryLink\}/);
    });

    it("gives the icon buttons the control height and a danger tone", () => {
        expect(rule(".lc-ibtn")).toMatch(/var\(--ctl-h-sm\)/);
        expect(rule(".lc-ibtn-danger")).toMatch(/var\(--high\)/);
    });
});

describe("loot council — Wowhead tooltips on the worn gear", () => {
    it("renders a worn item as a Wowhead link with the raider's gems and enchant", () => {
        const icon = fn("WornIcon");
        expect(icon).toMatch(/<a\s+className=\{`lc-worn \$\{marks\}`\}\s+href=\{wornWowheadUrl\(item\)\}/);
        expect(icon).not.toContain("HoverPanel");
        const url = fn("wornWowheadUrl");
        expect(url).toMatch(/ench=\$\{item\.enchantId\}/);
        expect(url).toMatch(/gems=\$\{item\.gemIds\.join\(":"\)\}/);
        expect(url).toMatch(/https:\/\/www\.wowhead\.com\/tbc\/item=\$\{item\.itemId\}/);
        expect(api).toMatch(/gemIds: number\[\];\s*enchantId: number;/);
    });

    it("re-scans for the widget after every render with new gear", () => {
        expect(page).toMatch(/import \{ refreshWowheadLinks \} from "\.\.\/lib\/wowheadTooltips";/);
        expect(page).toMatch(/useEffect\(\(\) => \{ refreshWowheadLinks\(\); \}, \[data, view\.tab\]\);/);
    });

    it("keeps the marks on the icon, with the reasons Wowhead cannot know", () => {
        const icon = fn("WornIcon");
        expect(icon).toMatch(/lc-worn-tag-bis/);
        expect(icon).toMatch(/lc-worn-tag-noench/);
        expect(icon).toMatch(/lc-worn-tag-socket/);
        expect(icon).toMatch(/lc-worn-mark-sit" title=\{`Zählt im Vergleich nicht/);
        expect(icon).toMatch(/lc-worn-mark-sub"[\s\S]{0,80}title=\{`Steht hier statt/);
    });
});

// Guards for the drop check's per-candidate gear expand (design-canvas
// https://claude.ai/artifact/BhCgrRMbfFV58brmCmmRV4):
//   * a candidate with no measured number says "Fehler" (with the reason) when
//     a run was actually attempted and failed, "nicht simuliert" only when it
//     was never tried — the two used to render identically;
//   * a ↻ button next to that cell can retry just the one candidate;
//   * a chevron folds a candidate's gear (source, PvP hint, worn items, reload
//     actions) into a row of its own — opt-in per table via `expandable`, so
//     the BiS-gap table (which wires none of the callbacks) is unchanged;
//   * GearBadges moved out of the raider dialog into the shared parts module,
//     so the dialog and the drop check draw the same badges from the same code.
const { files, fn } = require("./councilHelpers");

const { council, parts, dialog, drop } = files;

describe("loot council — Fehler vs. nicht simuliert", () => {
    it("adds a simErrorFor reader beside deltaFor, telling a failed run apart from an unattempted one", () => {
        const helper = fn(council, "simErrorFor");
        expect(helper).toMatch(/item\.dps === null/);
        expect(helper).toMatch(/item\.error \|\| "Simulation fehlgeschlagen\."/);
    });

    it("GainCell shows Fehler for a real failure and nicht simuliert otherwise, both with a retry button", () => {
        const cell = fn(parts, "GainCell");
        expect(cell).toMatch(/simError \? "Fehler" : "nicht simuliert"/);
        expect(cell).toMatch(/onRetry \? \(/);
        expect(cell).toMatch(/icon=\{<RefreshIcon \/>\}/);
    });

    it("the retry button simulates only that one candidate, not the whole list", () => {
        expect(drop).toMatch(/const simulateOne = \(f: CouncilFocus, candidate: CouncilCandidate\) => \{\s*runSim\(\[f\.item\.id\], \[\{ key: candidate\.key, specKey: candidate\.specKey \}\]/);
        expect(drop).toMatch(/onRetry=\{\(candidate\) => simulateOne\(focus, candidate\)\}/);
    });
});

describe("loot council — candidate gear expand", () => {
    it("CandidateRow only adds the chevron and gear panel when the table opts in", () => {
        const row = fn(parts, "CandidateRow");
        expect(row).toMatch(/expandable \? \(/);
        expect(row).toMatch(/<Expand open=\{!!open\} onToggle=\{onToggleOpen \|\| \(\(\) => \{\}\)\} showLabel=\{false\}/);
        expect(row).toMatch(/\{expandable && open \? \(/);
        expect(row).toMatch(/<CandidateGearPanel candidate=\{candidate\}/);
    });

    it("CandidateTable keeps its own open/closed state per candidate key", () => {
        const table = fn(parts, "CandidateTable");
        expect(table).toMatch(/const \[openKeys, setOpenKeys\] = useState<Set<string>>\(new Set\(\)\);/);
        expect(table).toMatch(/open=\{openKeys\.has\(c\.key\)\}/);
    });

    it("the gear panel shows the source badges, every worn piece, and a PvP callout", () => {
        const panelFn = fn(parts, "CandidateGearPanel");
        expect(panelFn).toMatch(/<GearBadges gear=\{g\}/);
        expect(panelFn).toMatch(/g\.items\.map\(\(item\) => <WornIcon key=/);
        expect(panelFn).toMatch(/g && g\.pvpGear \? \(/);
        expect(panelFn).toMatch(/kein Boss-Set bekannt/);
    });

    it("Log/Armory reload buttons only appear when the caller wired them", () => {
        const panelFn = fn(parts, "CandidateGearPanel");
        expect(panelFn).toMatch(/onLoadLog \? <Button[\s\S]*?Log laden<\/Button> : null/);
        expect(panelFn).toMatch(/onLoadArmory \? \(/);
        expect(panelFn).toMatch(/Gear jetzt aus Armory holen/);
    });

    it("the drop check wires expandable and the reload actions; the BiS-gap table does not", () => {
        expect(drop).toMatch(/<CandidateTable[\s\S]{0,300}expandable\s*\n[\s\S]{0,300}onLoadLog=\{loadLog\}\s*\n\s*onLoadArmory=\{loadArmory\}/);
        // LootCouncilPage's BiS-gap card passes none of the new props, so its
        // table keeps the plain look — see CandidateTable's optional props.
        expect(files.page).toMatch(/<CandidateTable itemId=\{gap\.id\} candidates=\{gap\.candidates\} sim=\{sim\} sortState=\{sortState\} \/>/);
    });

    it("reloading gear after Log/Armory refreshes the focus and reports refusals, same wording as the raider dialog", () => {
        expect(drop).toMatch(/refreshCouncilArmory\(csrfToken, \[character\]\)/);
        expect(drop).toMatch(/loadCouncilLogGear\(csrfToken, \{ character \}\)/);
        expect(drop).toMatch(/armoryRejected === "pvp"/);
        expect(drop).toMatch(/logRejected === "pvp"/);
        expect(drop).toMatch(/die Armory zeigt PvP-Gear — es bleibt beim Set aus dem letzten Raid\./);
    });
});

describe("loot council — one GearBadges for both the dialog and the drop check", () => {
    it("the raider dialog no longer defines its own GearBadges", () => {
        expect(dialog).not.toMatch(/function GearBadges/);
        expect(dialog).toMatch(/GearBadges gear=\{g\} bisOwned=\{r\.bis\.owned\} bisTotal=\{r\.bis\.total\}/);
    });

    it("gearCounts reads a worn-item list directly, so a candidate's gear works the same as a raider's", () => {
        const helper = fn(council, "gearCounts");
        expect(helper).toMatch(/export function gearCounts\(items: WornItem\[\]\)/);
        expect(helper).not.toMatch(/raider\.gear/);
    });
});

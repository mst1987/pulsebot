// Guards for the loot council's actions and waits
// (src/web-client/src/pages/LootCouncilPage.tsx + pages/lootcouncil/*):
//   * per-raider actions go through one busy guard, keyed per raider, and
//     reload before the spinner goes away;
//   * no estimates: a gain appears once simulated, never before;
//   * every wait is a job toast, the simulation with its real progress;
//   * a loaded log or armory answer that was refused is reported.
const { files, fn } = require("./councilHelpers");

const { page, council, parts, dialog, drop, api, jobs } = files;

describe("loot council — busy state", () => {
    const main = fn(page, "LootCouncilPage");

    it("guards against a second click while one is in flight and always clears the key", () => {
        expect(main).toMatch(/if \(busy\.has\(key\)\) return;/);
        expect(main).toMatch(/} finally \{\s*setBusy\(\(prev\) => \{/);
    });

    it("routes every per-raider action through that guard, keyed per action and raider", () => {
        expect(main).toMatch(/const showExport = \(character: string\) => runFor\(\s*`export:\$\{character\}`/);
        expect(main).toMatch(/const setExcluded = \(character: string, excluded: boolean\) => runFor\(\s*`exclude:\$\{character\}`/);
        expect(main).toMatch(/const setRole = \(character: string, role: "" \| "caster" \| "healer"\) => runFor\(\s*`role:\$\{character\}`/);
        expect(main).toMatch(/runFor\(`loggear:\$\{character\}`/);
        expect(main).toMatch(/loadArmory\(\[character\], `armory:\$\{character\}`\)/);
    });

    it("shows the spinner on the button of that raider's action", () => {
        expect(dialog).toContain("running={busy.has(`exclude:${r.character}`)}");
        expect(dialog).toContain("running={busy.has(`export:${r.character}`)}");
        expect(dialog).toContain("running={busy.has(`armory:${r.character}`)}");
        expect(page).toContain("running={busy.has(`exclude:${e.character}`)}");
    });

    it("keeps the spinner until the reloaded list is on screen", () => {
        expect(main).toMatch(/await setCouncilExcluded\(character, excluded\);\s*await reloadAll\(\);/);
        expect(main).toMatch(/\(\) => refreshCouncilArmory\(characters\),[\s\S]{0,200}const fresh = await reloadAll\(\);/);
        expect(main).toMatch(/const fetchData = \(\) => getLootCouncil\(/);
        expect(main).toMatch(/return request\s*\.then/);
    });

    it("does not hand the promise-returning load to useEffect", () => {
        expect(main).not.toMatch(/useEffect\(load,/);
        expect(main).toMatch(/useEffect\(\(\) => \{ load\(\); \}, \[load\]\)/);
    });
});

describe("loot council — no estimates", () => {
    it("never renders the stat-weight value as a number", () => {
        const all = [page, parts, dialog, drop].join("\n");
        expect(all).not.toMatch(/\{best\.value/);
        expect(all).not.toMatch(/\{candidate\.value/);
        expect(all).not.toMatch(/: c\.value/);
        expect(all).not.toMatch(/geschätzt<\/span>/);
    });

    it("says 'nicht simuliert' where a guess would go", () => {
        const cell = fn(parts, "GainCell");
        expect(cell).toMatch(/if \(typeof simDelta !== "number"\)/);
        expect(cell).toMatch(/nicht simuliert/);
        expect(fn(parts, "CandidateRow")).toMatch(/<GainCell candidate=\{candidate\} simDelta=\{simDelta\}/);
    });

    it("ranks unsimulated candidates below every measured one", () => {
        expect(fn(council, "gainFor")).toMatch(/Number\.NEGATIVE_INFINITY/);
    });

    it("makes no suggestion until an item is simulated, except by need where nothing can be", () => {
        const pick = fn(council, "pickVerdict");
        expect(pick).toMatch(/basis: "pending"/);
        expect(pick).toMatch(/basis: "need"/);
        expect(fn(page, "VerdictGain")).toMatch(/höchster Bedarf/);
        expect(fn(page, "GapCard")).toMatch(/verdict\.basis === "pending"/);
        expect(drop).toMatch(/verdict\?\.basis === "pending"/);
    });

    it("simulates a picked drop on the spot, against its candidates only", () => {
        expect(drop).toMatch(/if \(d\.focus && d\.sim\.available\) autoSimRef\.current\(d\.focus\);/);
        expect(drop).toMatch(/const simulateDrop = \(f: CouncilFocus\) => \{[\s\S]*?\.filter\(\(c\) => c\.simSupported && c\.hasGear\)/);
    });

    it("drops stale sim results when the filter changes", () => {
        expect(page).toMatch(/useEffect\(\(\) => \{ setSim\(null\); \}, \[view\.role, view\.tiers, view\.contents, view\.category, view\.bisTier, setSim\]\);/);
    });
});

describe("loot council — waits are toasts", () => {
    it("reports through the shared job channel", () => {
        expect(page).toMatch(/import \{ useJobs, useToast \} from "\.\.\/components\/Jobs";/);
        for (const label of ["Loot-Council wird geladen", "Armory wird geladen", "Log wird geladen"]) {
            expect(page).toContain(`label: "${label}"`);
        }
        expect(drop).toContain("label: \"Drop wird geprüft\"");
        expect(council).toContain("label: \"Simulation\"");
        expect(page).toMatch(/label: "Loot-Council wird geladen", quiet: true/);
    });

    it("feeds the simulation's real progress into the toast and merges results", () => {
        const sim = fn(council, "useCouncilSim");
        expect(sim).toMatch(/update\(\{\s*progress: job\.total \? \(job\.progress \?\? 0\) \/ job\.total : undefined/);
        expect(sim).toMatch(/if \(simBusy\.current \|\| !subjects\.length\) return;/);
        expect(sim).toMatch(/items: \{ \.\.\.old\.items, \.\.\.entry\.items \}/);
        expect(jobs).toMatch(/progress\?: number;/);
    });

    it("keeps no inline progress bar or error line of its own", () => {
        expect(page).not.toMatch(/function ProgressBar/);
        expect(page).not.toMatch(/simError/);
    });

    it("tells the reader what the armory and a loaded log did, refusals included", () => {
        const main = fn(page, "LootCouncilPage");
        expect(main).toMatch(/armoryRejected === "pvp"/);
        expect(main).toMatch(/die Armory zeigt PvP-Gear — es bleibt beim Set aus dem letzten Raid/);
        expect(main).toMatch(/const fresh = await reloadAll\(\);[\s\S]{0,400}logRejected === "pvp"/);
        expect(main).toMatch(/loadCouncilLogGear\(\{ character, \.\.\.pick \}\)/);
        expect(main).toMatch(/loadCouncilLogGear\(\{ character, clear: true \}\)/);
        expect(api).toMatch(/send\("POST", "\/api\/lootcouncil\/loggear", body\)/);
    });

    it("offers the bot's newest logs, the newest one with the raider, and a link", () => {
        const panel = fn(dialog, "LogPanel");
        expect(panel).toMatch(/logs\.map\(\(log\) =>/);
        expect(panel).toMatch(/onLoad\(\{ reportId: log\.reportId \}\)/);
        expect(panel).toMatch(/onLoad\(\{\}\)/);
        expect(panel).toMatch(/onLoad\(\{ link: value \}\)/);
        expect(page).toMatch(/logs=\{data\.recentLogs \|\| \[\]\}/);
    });

    it("confirms the per-raider actions in a toast", () => {
        expect(page).toMatch(/wird nicht mehr eingeplant\./);
        expect(page).toMatch(/wird wieder eingeplant\./);
        expect(page).toMatch(/eingeplant\.`\s*:\s*`Festlegung für/);
    });
});

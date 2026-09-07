// Guards for two rules of the loot council page
// (src/web-client/src/pages/LootCouncilPage.tsx + components/Jobs.tsx):
//
//   * **No estimates.** A gain is shown once it has been simulated and not
//     before. The old page put a stat-weight number labelled "geschätzt" next
//     to every candidate, and a council read it as a DPS figure. Now a
//     candidate without a simulated delta says "nicht simuliert", the verdict
//     of an unsimulated item is no name at all, and a picked drop is simulated
//     on the spot.
//   * **Waits are toasts.** A reload, the armory, a simulation — each runs as a
//     job toast anchored to the viewport, because the page is three screens
//     long and a progress bar under the filter section is one nobody sees.
//
// There is no React test renderer in this project, so the checks are on the
// source.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");
const page = read("pages", "LootCouncilPage.tsx");
const jobs = read("components", "Jobs.tsx");
const api = read("api.ts");

/** The body of one top-level function in the page source. */
function fn(name) {
    const m = page.match(new RegExp(`\\nfunction ${name}\\b[\\s\\S]*?\\n}\\n`));
    if (!m) throw new Error(`function ${name} not found`);
    return m[0];
}

describe("loot council — no estimates", () => {
    it("never renders the stat-weight value as a number", () => {
        // `value` is the server's ordering and stays in the payload; the page
        // must not print it.
        expect(page).not.toMatch(/\{best\.value/);
        expect(page).not.toMatch(/\{candidate\.value/);
        expect(page).not.toMatch(/: c\.value/);
        expect(page).not.toMatch(/geschätzt<\/span>/);
        expect(page).not.toMatch(/Schätzung aus Stat-Gewichten/);
    });

    it("says 'nicht simuliert' where the old page put a guess", () => {
        const cell = fn("GainCell");
        expect(cell).toMatch(/nicht simuliert/);
        // A measured number is the only thing drawn as a gain.
        expect(cell).toMatch(/if \(typeof simDelta !== "number"\)/);
        expect(cell).toMatch(/lc-gain lc-gain-measured/);
        expect(fn("CandidateRow")).toMatch(/<GainCell candidate=\{candidate\} simDelta=\{simDelta\}/);
    });

    it("ranks unsimulated candidates below every measured one", () => {
        expect(fn("gainFor")).toMatch(/Number\.NEGATIVE_INFINITY/);
        expect(fn("gainFor")).not.toMatch(/candidate\.value/);
    });

    it("makes no suggestion until an item is simulated", () => {
        const pick = fn("pickVerdict");
        expect(pick).toMatch(/basis: "pending"/);
        // ...except where nothing could ever be simulated: then by need, labelled.
        expect(pick).toMatch(/basis: "need"/);
        expect(fn("VerdictGain")).toMatch(/höchster Bedarf/);
        expect(fn("GapCard")).toMatch(/verdict\.basis === "pending"/);
        expect(fn("DropPanel")).toMatch(/verdict\.basis === "pending"/);
    });

    it("simulates a picked drop on the spot instead of waiting for a click", () => {
        expect(page).toMatch(/if \(d\.focus && d\.sim\.available\) autoSimRef\.current\(d\.focus\);/);
        // ...against that drop's candidates only, not the whole roster.
        expect(page).toMatch(/const simulateDrop = \(f: CouncilFocus\) => \{[\s\S]*?\.filter\(\(c\) => c\.simSupported && c\.hasGear\)/);
    });
});

describe("loot council — waits are toasts", () => {
    it("reports through the shared job channel", () => {
        expect(page).toMatch(/import \{ useJobs, useToast \} from "\.\.\/components\/Jobs";/);
        for (const label of ["Loot-Council wird geladen", "Drop wird geprüft", "Armory wird geladen", "Simulation"]) {
            expect(page).toContain(`label: "${label}"`);
        }
    });

    it("keeps no inline progress bar or error line of its own", () => {
        expect(page).not.toMatch(/function ProgressBar/);
        expect(page).not.toMatch(/function remainingLabel/);
        expect(page).not.toMatch(/simError/);
    });

    it("feeds the simulation's real progress into the toast", () => {
        expect(page).toMatch(/update\(\{\s*progress: job\.total \? \(job\.progress \?\? 0\) \/ job\.total : undefined/);
        expect(jobs).toMatch(/progress\?: number;/);
        expect(jobs).toMatch(/runner: \(update: JobUpdate\) => Promise<T>/);
        // A measured progress is drawn as it is, never the estimated creep.
        expect(jobs).toMatch(/const measured = typeof job\.progress === "number";/);
    });

    it("drops a quiet job's toast on success, keeps it on failure", () => {
        expect(jobs).toMatch(/quiet\?: boolean;/);
        expect(jobs).toMatch(/if \(spec\.quiet\) \{\s*dismiss\(id\);\s*return result;\s*\}/);
        // Reloads are quiet: a ✓ after every filter click would be noise.
        expect(page).toMatch(/label: "Loot-Council wird geladen", quiet: true/);
    });

    it("tells the reader what the armory did, PvP refusal included", () => {
        expect(page).toMatch(/armoryRejected === "pvp"/);
        expect(page).toMatch(/die Armory zeigt PvP-Gear — es bleibt beim Set aus dem letzten Raid/);
        expect(fn("GearStamp")).toMatch(/Armory: PvP-Gear/);
    });

    it("confirms the per-raider actions in a toast", () => {
        expect(page).toMatch(/wird nicht mehr eingeplant\./);
        expect(page).toMatch(/wird wieder eingeplant\./);
        expect(page).toMatch(/eingeplant\.`\s*:\s*`Festlegung für/);
    });
});

describe("loot council — who cannot wear the item", () => {
    it("carries the server's list into the drop check", () => {
        expect(api).toMatch(/export type CouncilUnwearable = \{/);
        expect(api).toMatch(/unwearable: CouncilUnwearable\[\];/);
        const drop = fn("DropPanel");
        expect(drop).toMatch(/focus\.unwearable\.map\(\(u\) => \(/);
        expect(drop).toMatch(/Können es nicht tragen/);
        expect(drop).toMatch(/\{u\.note\}/);
    });
});

// Runs a raider's gear through the real WoWSims binary (`wowsimcli`) as a local
// subprocess. No external call, no network: the binary carries the item DB
// embedded (built `--tags=with_db`), so plain Wowhead ids in the request are
// enough.
//
// Flow: charGear snapshot -> loadout.js (equipment + player) -> presets.js
// (spec options, ground-truth APL, buffs, consumables) -> one-player
// RaidSimRequest as protojson -> `wowsimcli sim --infile … --outfile …` -> the
// DPS out of the RaidSimResult.
//
// ── Degrades instead of failing ──────────────────────────────────────────────
// Without a binary (`WOWSIMCLI_PATH` unset or pointing nowhere) every call
// answers `{ available: false }` and the loot council falls back to its stat
// weights. That is the normal state in CI and in a fresh worktree — the page
// stays useful, it just labels its numbers as estimates. Never make a missing
// binary an error: nobody should have to install a simulator to look at who got
// what last week.
//
// ⚠️ The binary version and the vendored APLs/presets belong together — the
// protojson schema and the embedded item DB hang on the release. Move
// WOWSIMS_VERSION here, `SIM_VERSION` in scripts/fetch-wowsims-data.js and the
// fetch script for the binary as one.

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { presetFor, encounter } = require("./presets");
const { playerFor } = require("./loadout");
const { aplForSpec, isSimSupported } = require("../../config/casterSpecs");

const REPO = "wowsims/tbc-new";
const WOWSIMS_VERSION = "v0.0.97";

// 10k iterations is WoWSims' own convention for a stable result and runs
// multi-core in about a second. The loot council sims the same raider several
// times (once bare, once per candidate item), so this is the per-item cost.
const ITERATIONS = 10000;
const FIGHT_DURATION = 180;
// A sim that has not answered by then is not going to: kill it rather than let
// a page request hang on it.
const TIMEOUT_MS = 120000;

/** The wowsimcli binary, or null when none is configured/present. */
function binaryPath() {
    const p = process.env.WOWSIMCLI_PATH;
    return p && fs.existsSync(p) ? p : null;
}

/** Whether simulations can run at all right now. */
function isAvailable() {
    return !!binaryPath();
}

/**
 * The full sim request for one raider, optionally with one item swapped in.
 * Pure — no binary needed — so the request shape is unit-testable on its own.
 *
 * @param {object} args { gear, specEntry, swap, iterations, duration }
 * @returns {{supported: boolean, request: object|null, warnings: string[]}}
 */
function buildRequest({ gear, specEntry, swap = null, iterations = ITERATIONS, duration = FIGHT_DURATION }) {
    if (!isSimSupported(specEntry)) {
        return { supported: false, request: null, warnings: [`Für ${specEntry ? specEntry.label : "diese Spec"} gibt es in WoWSims-TBC keine Simulation.`] };
    }
    const preset = presetFor(specEntry);
    const apl = aplForSpec(specEntry);
    if (!preset || !apl) {
        return { supported: false, request: null, warnings: ["Kein WoWSims-Preset für diese Spec hinterlegt."] };
    }
    const { player, warnings } = playerFor({ gear, specEntry, preset, apl, swap });
    return {
        supported: true,
        warnings,
        request: {
            raid: {
                parties: [{ players: [player], buffs: preset.buffs.party }],
                buffs: preset.buffs.raid,
                debuffs: preset.buffs.debuffs,
            },
            encounter: encounter(duration),
            // A fixed seed makes two runs of the same loadout return the same
            // number. That matters more here than anywhere else: an upgrade is
            // reported as the *difference* between two runs, and without a seed
            // the sim's own noise (a few DPS at 10k iterations) would show up as
            // a phantom gain or loss on an item that changes nothing.
            simOptions: { iterations, randomSeed: "1" },
        },
    };
}

/** avg/stdev off a WoWSims DistributionMetrics node. */
function metric(node, key) {
    return node && typeof node[key] === "number" ? node[key] : null;
}

/** Run one prepared request through the binary. */
function runRequest(request) {
    const bin = binaryPath();
    if (!bin) return Promise.resolve({ available: false, dps: null, stdev: null, error: "" });
    return new Promise((resolve) => {
        let dir;
        try {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), "eh-wowsims-"));
        } catch (e) {
            return resolve({ available: true, dps: null, stdev: null, error: e.message });
        }
        const infile = path.join(dir, "in.json");
        const outfile = path.join(dir, "out.json");
        const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } };
        try {
            fs.writeFileSync(infile, JSON.stringify(request));
        } catch (e) {
            cleanup();
            return resolve({ available: true, dps: null, stdev: null, error: e.message });
        }
        const started = Date.now();
        execFile(bin, ["sim", "--infile", infile, "--outfile", outfile], { timeout: TIMEOUT_MS }, (err) => {
            let result = null;
            try {
                result = JSON.parse(fs.readFileSync(outfile, "utf8"));
            } catch {
                result = null;
            }
            cleanup();
            if (!result) {
                return resolve({ available: true, dps: null, stdev: null, error: (err && err.message) || "wowsimcli lieferte kein Ergebnis" });
            }
            // WoWSims reports a refused run in the result rather than in the exit
            // code (an unknown gem aborts the whole sim, for instance), so the
            // error field is checked even when the process succeeded.
            const failed = result.error && (result.error.message || result.errorResult);
            if (failed) return resolve({ available: true, dps: null, stdev: null, error: String(failed) });
            const player = result.raidMetrics
                && result.raidMetrics.parties
                && result.raidMetrics.parties[0]
                && result.raidMetrics.parties[0].players
                && result.raidMetrics.parties[0].players[0];
            resolve({
                available: true,
                dps: metric(player && player.dps, "avg"),
                stdev: metric(player && player.dps, "stdev"),
                durationMs: Date.now() - started,
                error: "",
            });
        });
    });
}

/**
 * DPS for one raider's current gear.
 * @returns {Promise<{available, supported, dps, stdev, warnings, error}>}
 */
async function simulate({ gear, specEntry, swap = null, iterations, duration }) {
    const built = buildRequest({ gear, specEntry, swap, iterations, duration });
    if (!built.supported) {
        return { available: isAvailable(), supported: false, dps: null, stdev: null, warnings: built.warnings, error: "" };
    }
    const run = await runRequest(built.request);
    return { ...run, supported: true, warnings: built.warnings };
}

/**
 * What one item would do for this raider: the DPS with it in, minus the DPS of
 * their current gear.
 *
 * The baseline is passed in rather than measured again per item — the caller
 * sims a raider's bare gear once and then every candidate against it, which
 * halves the runs and, more importantly, keeps every delta measured against the
 * exact same baseline number.
 *
 * @returns {Promise<{dps, delta, available, supported, error}>}
 */
async function simulateSwap({ gear, specEntry, swap, baselineDps, iterations, duration }) {
    const run = await simulate({ gear, specEntry, swap, iterations, duration });
    const delta = run.dps !== null && typeof baselineDps === "number" ? run.dps - baselineDps : null;
    return { ...run, delta };
}

module.exports = {
    isAvailable, binaryPath, buildRequest, runRequest, simulate, simulateSwap,
    ITERATIONS, FIGHT_DURATION, WOWSIMS_VERSION, REPO,
};

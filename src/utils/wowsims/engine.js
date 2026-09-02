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

// ⚠️ A gem the binary's embedded item DB does not know aborts the ENTIRE run —
// not the item, the whole simulation ("...had gem with id: <N>\nThis gem is not
// in the database."). Verified against the pinned binary. Raiders socket things
// no caster table anticipated, so without a retry one exotic gem costs that
// raider their number completely.
const UNKNOWN_GEM_RE = /gem with id:\s*(\d+)[\s\S]*?not in the database/i;
// Backstop against looping on a loadout full of unknown gems.
const MAX_GEM_RETRIES = 12;

/** The gem id named in a WoWSims error, or null. */
function parseUnknownGemId(message) {
    const m = String(message || "").match(UNKNOWN_GEM_RE);
    return m ? Number(m[1]) : null;
}

/** A copy of the request with one gem removed from every socket (0 = empty). */
function stripGem(request, gemId) {
    const clone = JSON.parse(JSON.stringify(request));
    const items = ((((clone.raid || {}).parties || [])[0] || {}).players || [])[0];
    for (const item of (items && items.equipment && items.equipment.items) || []) {
        if (!Array.isArray(item.gems)) continue;
        item.gems = item.gems.map((g) => (Number(g) === Number(gemId) ? 0 : g));
    }
    return clone;
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
 * The same loadout as a WoWSims "From JSON" import (IndividualSimSettings), so
 * anyone can paste it into wowsims.github.io/tbc and check our number.
 *
 * Deliberately built from the *same* pieces as the headless run — the enriched
 * player (gear, talents, spec options, ground-truth rotation, consumables),
 * plus the buff bundles and the encounter. An export that left any of them out
 * would reproduce a different number than the page shows, which would make it
 * worse than no export at all: it would look like the page is wrong.
 *
 * ⚠️ The WoWSims individual import does not switch class from the JSON — it has
 * to be pasted on that class's own sim page. The `class` field is informative.
 *
 * @returns {{supported, data, warnings, spec, sim}}
 */
function buildIndividualExport({ gear, specEntry, swap = null, duration = FIGHT_DURATION }) {
    if (!isSimSupported(specEntry)) {
        return { supported: false, data: null, warnings: [`Für ${specEntry ? specEntry.label : "diese Spec"} gibt es in WoWSims-TBC keine Simulation.`] };
    }
    const preset = presetFor(specEntry);
    const apl = aplForSpec(specEntry);
    if (!preset || !apl) return { supported: false, data: null, warnings: ["Kein WoWSims-Preset für diese Spec hinterlegt."] };

    const { player, warnings } = playerFor({ gear, specEntry, preset, apl, swap });
    return {
        supported: true,
        warnings,
        spec: specEntry.key,
        // Which sim page it belongs on — the import cannot switch class itself.
        sim: `${REPO} ${WOWSIMS_VERSION}`,
        data: {
            player,
            raidBuffs: preset.buffs.raid,
            partyBuffs: preset.buffs.party,
            debuffs: preset.buffs.debuffs,
            encounter: encounter(duration),
        },
    };
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

    // One unknown gem aborts the whole run, so retry without it rather than
    // letting a raider lose their number over one socket. Each removed gem is
    // reported: the result is then slightly low, and saying so is the point.
    let request = built.request;
    const warnings = [...built.warnings];
    for (let attempt = 0; attempt <= MAX_GEM_RETRIES; attempt += 1) {
        const run = await runRequest(request);
        const unknownGem = run.dps === null ? parseUnknownGemId(run.error) : null;
        if (unknownGem === null) return { ...run, supported: true, warnings };
        warnings.push(`Edelstein ${unknownGem} kennt WoWSims nicht — ohne ihn gerechnet, der Wert ist entsprechend etwas zu niedrig.`);
        request = stripGem(request, unknownGem);
    }
    return {
        available: true, supported: true, dps: null, stdev: null, warnings,
        error: "Zu viele WoWSims unbekannte Edelsteine in diesem Gear.",
    };
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
    parseUnknownGemId, stripGem, buildIndividualExport,
    ITERATIONS, FIGHT_DURATION, WOWSIMS_VERSION, REPO,
};

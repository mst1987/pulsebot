// The simulation half of the loot council: running raiders (and candidate
// items) through wowsimcli, caching what came back, and doing it in the
// background so a page load never waits on it.
//
// ── Why a cache, and why on disk ─────────────────────────────────────────────
// One run is ~1s at 10k iterations. Answering "who should get this item" for
// five casters means one baseline run each plus one run per candidate — a dozen
// seconds of CPU for a question a council asks repeatedly during one raid night.
// The result is deterministic (engine.js pins the random seed), so the same
// loadout always yields the same number and caching it costs nothing in
// accuracy. On disk rather than in memory, because a bot restart mid-raid
// should not throw the evening's numbers away.
//
// The cache key is the loadout itself — spec, every item/enchant/gem, and the
// swapped-in item — so a raider who changed a single gem is simulated again,
// automatically, without anyone having to invalidate anything.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const engine = require("../utils/wowsims/engine");
const { specByKey } = require("../config/casterSpecs");
const { equipmentFor, targetSlotFor } = require("../utils/wowsims/loadout");
const { gearByCharacter } = require("./charGear");

const CACHE_DIR = path.join(__dirname, "..", "..", "data", "sim");
const CACHE_FILE = path.join(CACHE_DIR, "results.json");

// Cached numbers stay valid as long as the loadout and the binary do — both are
// in the key — so entries only ever expire to keep the file from growing
// without bound. Two months covers a whole raid tier's worth of councils.
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

let cache = null;

function readCache() {
    if (cache) return cache;
    try {
        const data = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
        cache = data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch {
        cache = {};
    }
    return cache;
}

function writeCache() {
    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache || {}));
    } catch (e) {
        // A cache that cannot be written is a slow page, not a broken one.
        console.warn("sim cache write failed:", e.message);
    }
}

/**
 * The cache key of one run: everything that can change the number. The binary
 * version is in it because a new release re-tunes the sim, and a stale number
 * from the old one would silently outrank fresh ones.
 */
function cacheKey({ specKey, gear, swap }) {
    const { items } = equipmentFor(gear, swap);
    const payload = JSON.stringify({ v: engine.WOWSIMS_VERSION, specKey, items });
    return crypto.createHash("sha1").update(payload).digest("hex");
}

/** A cached result, or null. */
function getCached(key) {
    const entry = readCache()[key];
    if (!entry) return null;
    if (Date.now() - (entry.at || 0) > MAX_AGE_MS) return null;
    return entry;
}

function putCached(key, value) {
    readCache()[key] = { ...value, at: Date.now() };
    writeCache();
}

/**
 * Simulate one loadout, answering from the cache when possible.
 * @returns {Promise<{dps, stdev, cached, available, supported, error}>}
 */
async function simulateCached({ specKey, gear, swap = null, iterations }) {
    const specEntry = specByKey(specKey);
    if (!specEntry) return { dps: null, cached: false, available: engine.isAvailable(), supported: false, error: "Unbekannte Spec." };
    const key = cacheKey({ specKey, gear, swap });
    const hit = getCached(key);
    if (hit) return { ...hit, cached: true };
    const run = await engine.simulate({ gear, specEntry, swap, iterations });
    // Only a real number is worth remembering — a missing binary or a failed run
    // must not be cached, or fixing the cause would not fix the page.
    if (run.dps !== null) {
        putCached(key, { dps: run.dps, stdev: run.stdev, available: true, supported: true, error: "" });
    }
    return { ...run, cached: false };
}

// ── Jobs ─────────────────────────────────────────────────────────────────────
// A council run sims a whole roster, which takes longer than any HTTP request
// should be held open. The API starts one of these and the client polls, the
// same shape the CLA evaluations use (see evalJobs.js) — deliberately separate
// from those, because a sim job carries a result payload and they carry a
// report id.

// id -> { status, startedAt, finishedAt, progress, total, result, error }
const jobs = new Map();
const KEEP_FINISHED_MS = 30 * 60 * 1000;

function prune(now = Date.now()) {
    for (const [id, job] of jobs) {
        if (job.finishedAt && now - job.finishedAt > KEEP_FINISHED_MS) jobs.delete(id);
    }
}

/** A running or recently finished job by id, or null. */
function getJob(id) {
    prune();
    const job = jobs.get(String(id || ""));
    return job ? { ...job } : null;
}

/**
 * Baseline DPS for a set of raiders, then the DPS with each candidate item
 * swapped in — as a background job.
 *
 * @param {string} id             job id (the caller's, so it can poll)
 * @param {object[]} subjects     [{ key, specKey }]
 * @param {number[]} itemIds      candidate items ([] = baselines only)
 * @returns {{status: string, alreadyRunning: boolean}}
 */
function startCouncilSim(id, subjects, itemIds = []) {
    prune();
    const jobId = String(id || "");
    const existing = jobs.get(jobId);
    if (existing && existing.status === "running") return { status: "running", alreadyRunning: true };

    const total = subjects.length * (1 + itemIds.length);
    const job = {
        status: "running",
        startedAt: Date.now(),
        finishedAt: 0,
        progress: 0,
        total,
        available: engine.isAvailable(),
        result: null,
        error: "",
    };
    jobs.set(jobId, job);

    // Deliberately not awaited — the caller answers immediately.
    (async () => {
        try {
            // The same role gate the page uses: simulating a caster's healing
            // set produces a number that is honestly measured and completely
            // meaningless. Each subject already says which spec it is judged
            // as, so the role follows from that.
            const roleByKey = new Map(subjects.map((s) => [s.key, (specByKey(s.specKey) || {}).role || ""]));
            const gearMap = gearByCharacter({ roleFor: (key) => roleByKey.get(key) || "" });
            const out = {};
            for (const subject of subjects) {
                const gear = gearMap.get(subject.key) || null;
                const entry = { baseline: null, items: {}, hasGear: !!gear };
                if (gear) {
                    const base = await simulateCached({ specKey: subject.specKey, gear });
                    entry.baseline = base.dps;
                    entry.error = base.error || "";
                    job.progress += 1;
                    for (const itemId of itemIds) {
                        const target = targetSlotFor(gear, itemId);
                        if (!target) { job.progress += 1; continue; }
                        const run = await simulateCached({
                            specKey: subject.specKey, gear,
                            // `clears` matters for two-handers: without it the
                            // off hand stays equipped next to the staff and the
                            // run reports DPS off gear the raider cannot wear.
                            swap: { slot: target.slot, itemId: Number(itemId), clears: target.clears },
                        });
                        entry.items[itemId] = {
                            dps: run.dps,
                            delta: run.dps !== null && base.dps !== null ? Math.round((run.dps - base.dps) * 10) / 10 : null,
                            slot: target.slot,
                            cached: run.cached,
                        };
                        job.progress += 1;
                    }
                } else {
                    // No gear snapshot: nothing to sim, and saying so is more
                    // useful than a zero that looks like "this item is worthless
                    // to them".
                    job.progress += 1 + itemIds.length;
                }
                out[subject.key] = entry;
            }
            job.result = out;
            job.status = "done";
        } catch (e) {
            job.status = "error";
            job.error = e.message;
        } finally {
            job.finishedAt = Date.now();
        }
    })();

    return { status: "running", alreadyRunning: false };
}

/** Drop everything — tests only. */
function reset() {
    jobs.clear();
    cache = {};
}

module.exports = {
    simulateCached, cacheKey, getCached, putCached, startCouncilSim, getJob, reset,
    CACHE_FILE, MAX_AGE_MS, KEEP_FINISHED_MS,
};

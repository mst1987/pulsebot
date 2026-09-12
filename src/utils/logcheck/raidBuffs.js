// Raid buffs on the players, per fight, on the timeline.
//
// The consumables check says whether a raider brought their own flask; this
// one says what the *others* put on them — Kings missing in group three, no
// Mark of the Wild on the healers, Shadow Protection not renewed for the
// Shahraz pull. Per boss fight and player it keeps, for every buff that was
// there or should have been, whether it was up the whole fight (`full`), came
// only after the pull but then stayed (`late`), was not there throughout —
// ran out, or had a hole (`partial`) — or never came (`none`), and the merged
// bands so the page can draw them. Only derived intervals are stored, never
// raw events, and a player is judged until their death (the first one, if
// they were resurrected and died again), not until the fight's end.
//
// Only a player whose buffs table was fetched is judged at all: someone in
// the fight's roster without a table (the request failed, or they were not
// among the selected players) would otherwise lack every buff and drive the
// raid finding on nothing but a missing request. They still count towards
// the roster's classes and paladins — they raided, and their blessings were
// real — they are just not judged.
//
// What is expected comes from the roster of that fight, never from a fixed
// list: no paladin means no blessing is missing, one paladin means one
// blessing per player, and which one follows the player's role (Might on the
// warrior, Wisdom on the priest — see config/raidBuffs.js).
//
// Source of the bands: WCL's buffs table with `sourceid` set to the player.
// For the buffs/debuffs tables WCL's "source" is the unit the aura is ON —
// the player carrying the buff, not the paladin who cast it. That is the same
// reading consumables.js relies on (a flask is self-cast, so it proves
// nothing) and totems.js (the totem's party buff on the shaman, cast by the
// totem, not the shaman — which only works if source means the carrier), and
// it is what WCL's own Buffs view shows when a player is picked. `targetid`
// would select by caster and is the wrong axis here.
//
// Two buffs the table cannot show at the pull — see untrackedBuffs() — are
// read off the raw buff events instead (inferBands()): a buff the log later
// removes or refreshes on a player was on them before; a death that strips
// every other buff but not this one proves it was missing; a player with
// neither is `unknown`, never `none`.
const { BUFFS, BLESSINGS, buffByGuid, buffByKey, buffFits, expectedBlessings } = require("../../config/raidBuffs");
const { roleForClass } = require("./rpb/common");
const { clipBands, mergeBands, gapsBetween } = require("./fightTimeline");

// Uptime (of the judged window) from which a buff counts as "there": a buff
// applied a few seconds after the pull is still a buff; one that ran out
// half-way is not.
const FULL_PCT = 95;

// A buff counts as "at the pull" when a band covers this much of the fight's
// start — WCL synthesizes those bands from the combatant info.
const PULL_WINDOW_MS = 2000;

// A death strips every aura within this window of the death event; a
// removebuff inside it belongs to the death, the absence of one is proof.
const STRIP_WINDOW_MS = 1500;

/**
 * Bands for the buffs the combatant info leaves out, read off the raw buff
 * events of the whole log.
 *
 * WCL synthesizes a band at the pull only from the combatant info, and the
 * Anniversary client lists neither Fortitude nor Mark of the Wild there, so
 * the table shows them on nobody. The events still see them go: a
 * `removebuff` (death, expiry) or `refreshbuff` (re-cast on a player who
 * had it) proves the buff was on the player up to that moment — since the
 * last point we know it was not there, or the start of the log. An
 * `applybuff` proves it was not there right before, and is there from then
 * on. What the events do NOT see is the re-buff after a wipe: WCL keeps no
 * events outside its fights, and a raid re-buffs out of combat (verified on
 * a real log: 82 removes at deaths, a handful of applies). So a remove is
 * never read as "absent until the next apply"; after it the buff is unknown
 * until the next event. One thing does prove absence: a death that removed
 * other buffs (a witnessed death — 52 of 58 in that log) but none of this
 * key's ranks. Such a death closes whatever was open and becomes the anchor
 * the next remove can reach back to.
 *
 * Single and group ranks are tracked per aura id and the bands unioned, so
 * a Fortitude put on top of a Prayer neither doubles nor cuts anything.
 *
 * @param {object} input
 * @param {Array}  input.events     WCL buffs events (applybuff / refreshbuff / removebuff)
 *                                  of the keys' ids, plus removebuff events of any other
 *                                  raid buff as death witnesses; absolute timestamps
 * @param {Iterable<string>} input.keys   the buff keys to infer
 * @param {object} input.idToPlayer  actor id -> { name }
 * @param {Array<{ name: string, at: number }>} [input.deaths]  absolute death times
 * @param {number} input.logEnd     where an open band ends
 * @returns {Object<string, { byKey: Object<string, Array<{ startTime, endTime }>>, absentAt: Object<string, number[]> }>}
 *          per player name; `absentAt[key]` lists the witnessed deaths without the buff
 */
function inferBands({ events, keys, idToPlayer, deaths, logEnd }) {
    const byPlayer = new Map();
    for (const e of events || []) {
        if (!e || !e.ability || !Number.isFinite(e.timestamp)) continue;
        const p = idToPlayer && idToPlayer[e.targetID];
        if (!p || !p.name) continue;
        if (!byPlayer.has(p.name)) byPlayer.set(p.name, []);
        byPlayer.get(p.name).push(e);
    }
    const removedNear = (list, t, ids) => list.some((e) => e.type === "removebuff" && Math.abs(e.timestamp - t) <= STRIP_WINDOW_MS && (!ids || ids.has(String(e.ability.guid))));
    const out = {};
    for (const [name, list] of byPlayer) {
        list.sort((a, b) => a.timestamp - b.timestamp);
        const witnessed = (deaths || []).filter((d) => d && d.name === name && Number.isFinite(d.at) && removedNear(list, d.at, null)).map((d) => d.at);
        const byKey = {};
        const absentAt = {};
        for (const key of keys) {
            const def = buffByKey(key);
            if (!def) continue;
            const ids = new Set(def.ids.map(String));
            const absent = witnessed.filter((t) => !removedNear(list, t, ids));
            absentAt[key] = absent;
            const stream = [
                ...list.filter((e) => ids.has(String(e.ability.guid))).map((e) => ({ t: e.timestamp, type: e.type, guid: String(e.ability.guid) })),
                ...absent.map((t) => ({ t, type: "absent" })),
            ].sort((a, b) => a.t - b.t);
            const bands = [];
            const open = new Map(); // guid -> start
            let anchor = 0; // the last moment the buff is known to have been off
            for (const e of stream) {
                if (e.type === "applybuff") {
                    if (!open.has(e.guid)) open.set(e.guid, e.t);
                } else if (e.type === "refreshbuff") {
                    if (!open.has(e.guid)) open.set(e.guid, anchor);
                } else if (e.type === "removebuff") {
                    const from = open.has(e.guid) ? open.get(e.guid) : anchor;
                    if (e.t > from) bands.push({ startTime: from, endTime: e.t });
                    open.delete(e.guid);
                    anchor = Math.max(anchor, e.t);
                } else if (e.type === "absent") {
                    for (const from of open.values()) if (e.t > from) bands.push({ startTime: from, endTime: e.t });
                    open.clear();
                    anchor = Math.max(anchor, e.t);
                }
            }
            for (const from of open.values()) if (logEnd > from) bands.push({ startTime: from, endTime: logEnd });
            if (bands.length) byKey[key] = bands;
        }
        out[name] = { byKey, absentAt };
    }
    return out;
}

/**
 * The buffs this log cannot show: class buffs that sit on fewer than half of
 * the raid at the typical pull. On the Anniversary client the combat log's
 * combatant info lists the blessings, Arcane Brilliance, Prayer of Spirit and
 * Shadow Protection at the pull, but not Fortitude or Mark of the Wild — those
 * only ever show a band when somebody re-casts them during the log (verified:
 * 3 of 25 players with a band, 0 of 25 in the combatant info). A raid does not
 * run a night with Fortitude on three people, so a buff that is on nobody or
 * a stray few at pull after pull is the log's blind spot, not the raid's
 * fault. analyzeRaidBuffs reads such a buff off the raw events instead
 * (inferBands); only when that fails is it left out of the judgement (shown
 * as "im Log nicht nachweisbar"). A buff that half the raid demonstrably had
 * is tracked, and missing it is a real finding.
 *
 * "The typical pull" is the lower median over the boss fights, and that is
 * deliberate: "at any pull" was the first rule, and one wipe broke it — a
 * death removes every aura, WCL draws a band from the pull to the death for
 * each, and the wipe fight showed Fortitude on all 25 while the other fifteen
 * fights showed it on nobody. Likewise "nobody at all" fails on a single
 * re-cast that happens to land on a pull.
 *
 * @param {Object<string, { byKey }>} bandsByName
 * @param {Array} bossFights   WCL fights with start_time
 * @returns {Set<string>} buff keys
 */
function untrackedBuffs(bandsByName, bossFights) {
    const out = new Set();
    if (!bossFights || bossFights.length === 0) return out;
    const entries = Object.values(bandsByName || {}).filter(Boolean);
    if (entries.length === 0) return out;
    for (const def of BUFFS) {
        // only the class buffs: a majority buff nobody carried is simply not a majority
        if (def.expect !== "class") continue;
        const perFight = bossFights.map((f) => {
            let atPull = 0;
            for (const entry of entries) {
                const bands = (entry.byKey && entry.byKey[def.key]) || [];
                if (bands.length && overlaps(bands, f.start_time, f.start_time + PULL_WINDOW_MS)) atPull++;
            }
            return atPull;
        }).sort((a, b) => a - b);
        const typical = perFight[Math.floor((perFight.length - 1) / 2)];
        if (typical * 2 < entries.length) out.add(def.key);
    }
    return out;
}

const ROLE_OF = { Tank: "tank", Healer: "healer", Caster: "caster", Physical: "melee" };

/**
 * A player's buff role (tank / healer / melee / caster) from the specs WCL's
 * summary lists for them in a fight. Without specs the class alone decides,
 * the way the RPB does it.
 */
function buffRole(type, specs) {
    const counts = { dps: 0, tank: 0, healer: 0, dpsSpec: "" };
    for (const s of specs || []) {
        if (!s) continue;
        if (s.role === "tank") counts.tank++;
        else if (s.role === "healer") counts.healer++;
        else if (s.role === "dps") {
            counts.dps++;
            if (s.spec) counts.dpsSpec = s.spec;
        }
    }
    return ROLE_OF[roleForClass(type, counts)] || "melee";
}

/** The fight's roster from WCL's summary composition: { id, name, type, role } per known player. */
function rosterFromSummary(summary, idToPlayer) {
    const out = [];
    for (const m of (summary && summary.composition) || []) {
        if (!m) continue;
        const known = idToPlayer[m.id];
        const type = (known && known.type) || m.type;
        const name = (known && known.name) || m.name;
        if (!type || !name) continue;
        out.push({ id: m.id, name, type, role: buffRole(type, m.specs) });
    }
    return out;
}

/** Whether any of the absolute bands overlaps the window. */
function overlaps(bands, start, end) {
    return (bands || []).some((b) => b && b.startTime <= end && (b.endTime === undefined || b.endTime === null || b.endTime >= start));
}

/** Fallback roster without a summary: whoever carried any aura during the fight, role by class alone. */
function rosterFromBands(players, bandsByName, fight) {
    const out = [];
    for (const p of players || []) {
        const all = bandsByName[p.name] && bandsByName[p.name].all;
        if (!overlaps(all, fight.start_time, fight.end_time)) continue;
        out.push({ id: p.id, name: p.name, type: p.type, role: buffRole(p.type, []) });
    }
    return out;
}

/** Cut fight-relative bands down to the judged window [0, until]. */
function judgedBands(bands, until) {
    const out = [];
    for (const [a, z] of mergeBands(bands)) {
        const to = Math.min(z, until);
        if (to > a) out.push([a, to]);
    }
    return out;
}

/**
 * A buff's status on a player from its judged bands: `full` from FULL_PCT
 * uptime on, `none` without any, `late` for one single band that starts after
 * the pull and reaches the end of the judged window (set after the pull, then
 * kept), `partial` for everything else — ran out, or had a hole.
 */
function statusOf(bands, judgeEnd, uptimePct) {
    if (uptimePct >= FULL_PCT) return "full";
    if (!(uptimePct > 0) || !bands.length) return "none";
    const [from, to] = bands[0];
    return bands.length === 1 && from > 0 && to >= judgeEnd ? "late" : "partial";
}

/** Status -> which counter it is tallied under. `unknown` (an inferred buff without evidence) has its own. */
const STATUSES = ["full", "late", "partial", "none"];

function emptyTally() {
    return { expected: 0, full: 0, late: 0, partial: 0, none: 0, unknown: 0, present: 0, wrong: 0 };
}

/** Whether a status says the buff was there at all. */
function seen(status) {
    return status !== "none" && status !== "unknown";
}

/**
 * One fight's buff picture. Pure: the API calls happen in analyzeRaidBuffs.
 *
 * @param {object} input
 * @param {object} input.fight        WCL fight (start_time, end_time)
 * @param {Array}  input.roster       { name, type, role } per player in the fight
 * @param {Object<string, { byKey: Object<string, Array>, absentAt?: Object<string, number[]> }>} input.bandsByName
 *        per player, per buff key, the absolute WCL bands ({ startTime, endTime });
 *        a roster player without an entry here is not judged; `absentAt` (inferBands)
 *        lists per inferred key the deaths that proved the buff missing
 * @param {Array}  [input.deaths]     the fight's deaths ({ at, name }), fight-relative
 * @param {Object<string, string>} [input.icons]  buff key -> icon the log reported
 * @param {Set<string>} [input.untracked]  buff keys the log cannot show (untrackedBuffs): never expected
 * @param {Set<string>} [input.inferred]   buff keys whose bands come from inferBands: expected as
 *        usual, but without a band the status is `unknown` unless a death proved it missing
 * @returns {null | { paladins, expected: string[], untracked: string[], inferred: string[], players: Array, coverage: Array }}
 *          players[]: { name, type, role, judgedUntil, diedAt, buffs: [{ key, label,
 *          icon, status: full|late|partial|none|unknown, uptimePct, expected, wrong, bands }],
 *          missing[], late[], partial[], wrong[] }
 */
function buffsForFight({ fight, roster, bandsByName, deaths, icons, untracked, inferred }) {
    if (!roster || roster.length === 0) return null;
    const blind = untracked instanceof Set ? untracked : new Set(untracked || []);
    const inferredKeys = inferred instanceof Set ? inferred : new Set(inferred || []);
    const start = fight.start_time;
    const end = fight.end_time;
    const duration = end - start;
    // the first death ends the judged window — the same reading totems.js takes
    const diedAt = new Map();
    for (const d of deaths || []) {
        if (!d || !Number.isFinite(d.at)) continue;
        if (!diedAt.has(d.name) || d.at < diedAt.get(d.name)) diedAt.set(d.name, d.at);
    }
    const classes = new Set(roster.map((p) => p.type));
    const paladins = roster.filter((p) => p.type === "Paladin").length;

    // First pass: every buff's status on every player, before deciding what
    // was expected — the "majority" rule needs the whole picture.
    const cells = new Map(); // name -> key -> { status, uptimePct, bands }
    const judged = new Map(); // name -> judgeEnd
    for (const p of roster) {
        // no buffs table for this player: not judged (see the header)
        if (!bandsByName || !bandsByName[p.name]) continue;
        const judgeEnd = diedAt.has(p.name) ? Math.min(duration, diedAt.get(p.name)) : duration;
        if (judgeEnd <= 0) continue;
        judged.set(p.name, judgeEnd);
        const mine = bandsByName[p.name].byKey || {};
        const absentAt = bandsByName[p.name].absentAt || {};
        const row = new Map();
        for (const def of BUFFS) {
            const bands = judgedBands(clipBands(mine[def.key] || [], start, end), judgeEnd);
            const gaps = gapsBetween(bands, judgeEnd);
            let status = statusOf(bands, judgeEnd, gaps.uptimePct);
            // an inferred buff without a band: missing only if a death in the
            // judged window proved it, otherwise simply not shown by the log
            if (status === "none" && inferredKeys.has(def.key)) {
                const proven = (absentAt[def.key] || []).some((t) => t >= start && t <= start + judgeEnd + STRIP_WINDOW_MS);
                status = proven ? "none" : "unknown";
            }
            row.set(def.key, { status, uptimePct: gaps.uptimePct, bands });
        }
        cells.set(p.name, row);
    }

    // Which majority-buffs the raid meant to use in this fight: at least half
    // of the players it is for carried it at some point.
    const majority = new Set();
    for (const def of BUFFS) {
        if (def.expect !== "majority") continue;
        const fitting = roster.filter((p) => judged.has(p.name) && buffFits(def, p));
        const carrying = fitting.filter((p) => seen(cells.get(p.name).get(def.key).status));
        if (carrying.length > 0 && carrying.length * 2 >= fitting.length) majority.add(def.key);
    }

    const players = [];
    const coverage = new Map();
    const tally = (key, field) => {
        if (!coverage.has(key)) coverage.set(key, { key, ...emptyTally() });
        coverage.get(key)[field]++;
    };
    for (const p of roster) {
        if (!judged.has(p.name)) continue;
        const judgeEnd = judged.get(p.name);
        const row = cells.get(p.name);
        const expected = new Set();
        const wrong = new Set();
        for (const def of BUFFS) {
            const fits = buffFits(def, p);
            // the log cannot show it: never expected, whatever the roster says
            if (blind.has(def.key)) continue;
            if (def.expect === "class") {
                if (fits && classes.has(def.provider)) expected.add(def.key);
            } else if (def.expect === "majority") {
                if (fits && majority.has(def.key)) expected.add(def.key);
            } else if (def.expect === "blessing") {
                // a `neverWrong` blessing (Light, Sanctuary) is usual on any
                // role in TBC and never a wrong one — see config/raidBuffs.js
                if (!fits && !def.neverWrong && seen(row.get(def.key).status)) wrong.add(def.key);
            }
        }
        // Blessings: the paladins limit how many, the role says which. A slot
        // filled by any fitting blessing is filled — the raid may hand a
        // caster Salvation over Wisdom on purpose; only a slot left empty
        // names the highest-priority blessing that is not there. A blessing
        // that is never wrong fills a slot on any role.
        const wanted = expectedBlessings(p, paladins);
        let slots = wanted.length;
        for (const b of BLESSINGS) {
            if (slots === 0) break;
            if ((!buffFits(b, p) && !b.neverWrong) || row.get(b.key).status !== "full") continue;
            expected.add(b.key);
            slots--;
        }
        for (const b of wanted) {
            if (slots === 0) break;
            if (row.get(b.key).status === "full") continue;
            expected.add(b.key);
            slots--;
        }

        const buffs = [];
        const missing = [];
        const late = [];
        const partial = [];
        for (const def of BUFFS) {
            const c = row.get(def.key);
            const isExpected = expected.has(def.key);
            const isWrong = wrong.has(def.key);
            if (!seen(c.status) && !isExpected) continue;
            buffs.push({
                key: def.key, label: def.label, icon: (icons && icons[def.key]) || def.icon,
                status: c.status, uptimePct: c.uptimePct, expected: isExpected, wrong: isWrong,
                untracked: blind.has(def.key) || undefined,
                inferred: inferredKeys.has(def.key) || undefined,
                bands: seen(c.status) ? c.bands : [],
            });
            if (seen(c.status)) tally(def.key, "present");
            if (isWrong) tally(def.key, "wrong");
            if (isExpected && c.status === "unknown") {
                tally(def.key, "unknown");
            } else if (isExpected) {
                tally(def.key, "expected");
                tally(def.key, c.status);
                if (c.status === "none") missing.push(def.key);
                else if (c.status === "late") late.push(def.key);
                else if (c.status === "partial") partial.push(def.key);
            }
        }
        players.push({
            name: p.name, type: p.type, role: p.role,
            judgedUntil: judgeEnd, diedAt: judgeEnd < duration ? judgeEnd : null,
            buffs, missing, late, partial, wrong: [...wrong],
        });
    }
    if (players.length === 0) return null;
    const expectedKeys = BUFFS.map((b) => b.key).filter((k) => coverage.has(k) && (coverage.get(k).expected > 0 || coverage.get(k).unknown > 0));
    return {
        paladins,
        expected: expectedKeys,
        untracked: BUFFS.map((b) => b.key).filter((k) => blind.has(k)),
        inferred: BUFFS.map((b) => b.key).filter((k) => inferredKeys.has(k)),
        players,
        coverage: BUFFS.map((b) => b.key).filter((k) => coverage.has(k)).map((k) => coverage.get(k)),
    };
}

/**
 * Raid-wide summary over the fights: per player and buff the share of judged
 * fights the buff was fully there, per buff how well the raid was covered.
 */
function summarize(fights) {
    const byName = new Map();
    const byKey = new Map();
    let fightCount = 0;
    let paladins = 0;
    const untracked = new Set();
    const inferred = new Set();
    let unknownCells = 0;
    for (const f of fights) {
        const b = f.buffs;
        if (!b || !Array.isArray(b.players)) continue;
        fightCount++;
        paladins = Math.max(paladins, b.paladins || 0);
        for (const k of b.untracked || []) untracked.add(k);
        for (const k of b.inferred || []) inferred.add(k);
        for (const p of b.players) {
            if (!byName.has(p.name)) byName.set(p.name, { name: p.name, type: p.type, roles: {}, fights: 0, buffs: {}, missing: 0, late: 0, partial: 0, wrong: 0, unknown: 0 });
            const s = byName.get(p.name);
            s.fights++;
            s.roles[p.role] = (s.roles[p.role] || 0) + 1;
            s.missing += p.missing.length;
            s.late += (p.late || []).length;
            s.partial += p.partial.length;
            s.wrong += (p.wrong || []).length;
            for (const c of p.buffs) {
                if (!s.buffs[c.key]) s.buffs[c.key] = emptyTally();
                const cell = s.buffs[c.key];
                if (seen(c.status)) cell.present++;
                if (c.wrong) cell.wrong++;
                if (c.expected && c.status === "unknown") {
                    cell.unknown++;
                    s.unknown++;
                    unknownCells++;
                } else if (c.expected) {
                    cell.expected++;
                    if (STATUSES.includes(c.status)) cell[c.status]++;
                }
            }
        }
        for (const c of b.coverage || []) {
            if (!byKey.has(c.key)) {
                const def = BUFFS.find((d) => d.key === c.key) || {};
                byKey.set(c.key, { key: c.key, label: def.label || c.key, groupLabel: def.groupLabel || "", icon: def.icon || "", provider: def.provider || "", group: def.group || "", expect: def.expect || "", fights: 0, slots: 0, full: 0, late: 0, partial: 0, none: 0, unknown: 0, present: 0, wrong: 0, missingNames: new Set(), seenNames: new Set() });
            }
            const s = byKey.get(c.key);
            if (c.expected > 0) s.fights++;
            s.slots += c.expected;
            s.full += c.full;
            s.late += c.late || 0;
            s.partial += c.partial;
            s.none += c.none;
            s.unknown += c.unknown || 0;
            s.present += c.present;
            s.wrong += c.wrong;
        }
        for (const p of b.players) {
            for (const c of p.buffs) {
                const s = byKey.get(c.key);
                if (!s) continue;
                if (seen(c.status)) s.seenNames.add(p.name);
                if (c.expected && c.status !== "full" && c.status !== "unknown") s.missingNames.add(p.name);
            }
        }
    }
    const players = [...byName.values()].map((s) => {
        const role = Object.entries(s.roles).sort((a, b) => b[1] - a[1]).map(([r]) => r)[0] || "melee";
        const buffs = {};
        // pct: of the fights it was expected, the share it was fully there; a
        // buff never expected on this player shows how often it was there at all
        for (const [key, c] of Object.entries(s.buffs)) {
            const pct = c.expected ? (c.full / c.expected) : (s.fights ? c.present / s.fights : 0);
            buffs[key] = { ...c, pct: Math.round(pct * 100) };
        }
        return { name: s.name, type: s.type, role, fights: s.fights, buffs, missing: s.missing, late: s.late, partial: s.partial, wrong: s.wrong, unknown: s.unknown };
    });
    const rows = BUFFS.map((b) => b.key).filter((k) => byKey.has(k)).map((k) => {
        const s = byKey.get(k);
        return {
            key: s.key, label: s.label, groupLabel: s.groupLabel, icon: s.icon, provider: s.provider, group: s.group, expect: s.expect,
            expected: s.slots > 0, untracked: untracked.has(s.key), inferred: inferred.has(s.key), fights: s.fights, slots: s.slots, full: s.full, late: s.late, partial: s.partial, none: s.none, unknown: s.unknown,
            present: s.present, wrong: s.wrong,
            coveragePct: s.slots ? Math.round((s.full / s.slots) * 100) : null,
            missingPlayers: s.missingNames.size,
            seenPlayers: s.seenNames.size,
        };
    });
    // the blind spot is named even when the buff never made a row (nobody ever re-cast it)
    const describe = (b) => ({ key: b.key, label: b.label, groupLabel: b.groupLabel || "", icon: b.icon, provider: b.provider });
    const untrackedRows = BUFFS.filter((b) => untracked.has(b.key)).map(describe);
    const inferredRows = BUFFS.filter((b) => inferred.has(b.key)).map(describe);
    return { fights: fightCount, paladins, players, rows, untracked: untrackedRows, inferred: inferredRows, unknownCells };
}

/**
 * Fill `timeline.fights[].buffs` and return the raid-wide summary.
 *
 * One buffs table per player for the whole raid (the bands of every aura on
 * them — the same call consumables.js makes) plus one summary per boss fight
 * for who was there in which role. A fight whose summary fails falls back to
 * whoever carried any aura during it, with roles by class alone; a fight with
 * nobody keeps `buffs: null`.
 *
 * The buffs the tables cannot show (untrackedBuffs) cost one more walk over
 * the log's buff events — their own ranks plus the removes of every other
 * raid buff as death witnesses, a few hundred events — and are judged from
 * those (inferBands). If that walk fails they stay out of the judgement.
 *
 * @param {object} wcl
 * @param {string} reportId
 * @param {object} fights       WCL fights response
 * @param {Array}  players      selected roster entries ({ id, name, type })
 * @param {object} idToPlayer   actor id -> { name, type }
 * @param {object} timeline     the report's timeline (from analyzeFightTimeline); mutated
 * @returns {Promise<null | { fights, paladins, players: Array, rows: Array }>}
 */
async function analyzeRaidBuffs(wcl, reportId, fights, players, idToPlayer, timeline) {
    if (!timeline || !Array.isArray(timeline.fights) || timeline.fights.length === 0) return null;
    const byId = new Map((fights.fights || []).map((f) => [f.id, f]));
    const end = fights.end || 999999999999;

    const bandsByName = {};
    const icons = {};
    for (const p of players || []) {
        let table;
        try {
            table = await wcl.getBuffs(reportId, 0, end, { sourceid: p.id });
        } catch (e) {
            console.error(`raid buffs failed for ${p.name}:`, e.message);
            continue;
        }
        const byKey = {};
        const all = [];
        for (const aura of (table && table.auras) || []) {
            if (!aura || !Array.isArray(aura.bands)) continue;
            all.push(...aura.bands);
            const def = buffByGuid(aura.guid);
            if (!def) continue;
            if (!byKey[def.key]) byKey[def.key] = [];
            byKey[def.key].push(...aura.bands);
            if (aura.abilityIcon && !icons[def.key]) icons[def.key] = aura.abilityIcon;
        }
        bandsByName[p.name] = { byKey, all };
    }

    const bossFights = timeline.fights.map((row) => byId.get(row.id)).filter(Boolean);
    let untracked = untrackedBuffs(bandsByName, bossFights);
    let inferred = new Set();
    if (untracked.size && typeof wcl.getAllEvents === "function") {
        const ids = [...untracked].flatMap((k) => (buffByKey(k) || { ids: [] }).ids);
        const witnesses = BUFFS.filter((b) => !untracked.has(b.key) && ["blessing", "class", "majority"].includes(b.expect)).flatMap((b) => b.ids);
        const filter = `(ability.id in (${ids.join(",")})) or (type = 'removebuff' and ability.id in (${witnesses.join(",")}))`;
        try {
            const events = await wcl.getAllEvents(reportId, "buffs", 0, end, { filter }, { maxPages: 60 });
            const deaths = [];
            for (const row of timeline.fights) {
                const f = byId.get(row.id);
                if (!f) continue;
                for (const d of row.deaths || []) if (d && d.name && Number.isFinite(d.at)) deaths.push({ name: d.name, at: f.start_time + d.at });
            }
            const logEnd = Math.max(...bossFights.map((f) => f.end_time));
            const found = inferBands({ events, keys: untracked, idToPlayer, deaths, logEnd });
            for (const [name, entry] of Object.entries(found)) {
                if (!bandsByName[name]) continue; // no table: not judged anyway
                for (const [key, bands] of Object.entries(entry.byKey)) bandsByName[name].byKey[key] = [...(bandsByName[name].byKey[key] || []), ...bands];
                bandsByName[name].absentAt = entry.absentAt;
            }
            inferred = untracked;
            untracked = new Set();
            console.warn(`raid buffs: not in the combatant info, read off ${events.length} buff events instead: ${[...inferred].join(", ")}`);
        } catch (e) {
            console.error(`raid buffs: event inference failed, left unjudged (${[...untracked].join(", ")}):`, e.message);
        }
    }
    if (untracked.size) console.warn(`raid buffs: not shown by this log at any pull, left unjudged: ${[...untracked].join(", ")}`);

    let any = false;
    for (const row of timeline.fights) {
        const f = byId.get(row.id);
        if (!f) continue;
        let roster = [];
        try {
            const summary = await wcl.getSummary(reportId, f.start_time, f.end_time);
            roster = rosterFromSummary(summary, idToPlayer || {});
        } catch (e) {
            console.error(`raid buffs summary failed on ${f.name}:`, e.message);
        }
        if (roster.length === 0) roster = rosterFromBands(players, bandsByName, f);
        row.buffs = buffsForFight({ fight: f, roster, bandsByName, deaths: row.deaths, icons, untracked, inferred });
        if (row.buffs) any = true;
    }
    return any ? summarize(timeline.fights) : null;
}

module.exports = { analyzeRaidBuffs, buffsForFight, summarize, buffRole, rosterFromSummary, rosterFromBands, statusOf, untrackedBuffs, inferBands, FULL_PCT, PULL_WINDOW_MS, STRIP_WINDOW_MS };

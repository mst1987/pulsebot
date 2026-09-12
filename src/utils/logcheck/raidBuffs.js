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
const { BUFFS, BLESSINGS, buffByGuid, buffFits, expectedBlessings } = require("../../config/raidBuffs");
const { roleForClass } = require("./rpb/common");
const { clipBands, mergeBands, gapsBetween } = require("./fightTimeline");

// Uptime (of the judged window) from which a buff counts as "there": a buff
// applied a few seconds after the pull is still a buff; one that ran out
// half-way is not.
const FULL_PCT = 95;

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

/** Status -> which counter it is tallied under. */
const STATUSES = ["full", "late", "partial", "none"];

function emptyTally() {
    return { expected: 0, full: 0, late: 0, partial: 0, none: 0, present: 0, wrong: 0 };
}

/**
 * One fight's buff picture. Pure: the API calls happen in analyzeRaidBuffs.
 *
 * @param {object} input
 * @param {object} input.fight        WCL fight (start_time, end_time)
 * @param {Array}  input.roster       { name, type, role } per player in the fight
 * @param {Object<string, { byKey: Object<string, Array> }>} input.bandsByName
 *        per player, per buff key, the absolute WCL bands ({ startTime, endTime });
 *        a roster player without an entry here is not judged
 * @param {Array}  [input.deaths]     the fight's deaths ({ at, name }), fight-relative
 * @param {Object<string, string>} [input.icons]  buff key -> icon the log reported
 * @returns {null | { paladins, expected: string[], players: Array, coverage: Array }}
 *          players[]: { name, type, role, judgedUntil, diedAt, buffs: [{ key, label,
 *          icon, status: full|late|partial|none, uptimePct, expected, wrong, bands }],
 *          missing[], late[], partial[], wrong[] }
 */
function buffsForFight({ fight, roster, bandsByName, deaths, icons }) {
    if (!roster || roster.length === 0) return null;
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
        const row = new Map();
        for (const def of BUFFS) {
            const bands = judgedBands(clipBands(mine[def.key] || [], start, end), judgeEnd);
            const gaps = gapsBetween(bands, judgeEnd);
            row.set(def.key, { status: statusOf(bands, judgeEnd, gaps.uptimePct), uptimePct: gaps.uptimePct, bands });
        }
        cells.set(p.name, row);
    }

    // Which majority-buffs the raid meant to use in this fight: at least half
    // of the players it is for carried it at some point.
    const majority = new Set();
    for (const def of BUFFS) {
        if (def.expect !== "majority") continue;
        const fitting = roster.filter((p) => judged.has(p.name) && buffFits(def, p));
        const carrying = fitting.filter((p) => cells.get(p.name).get(def.key).status !== "none");
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
            if (def.expect === "class") {
                if (fits && classes.has(def.provider)) expected.add(def.key);
            } else if (def.expect === "majority") {
                if (fits && majority.has(def.key)) expected.add(def.key);
            } else if (def.expect === "blessing") {
                // a `neverWrong` blessing (Light, Sanctuary) is usual on any
                // role in TBC and never a wrong one — see config/raidBuffs.js
                if (!fits && !def.neverWrong && row.get(def.key).status !== "none") wrong.add(def.key);
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
            if (c.status === "none" && !isExpected) continue;
            buffs.push({
                key: def.key, label: def.label, icon: (icons && icons[def.key]) || def.icon,
                status: c.status, uptimePct: c.uptimePct, expected: isExpected, wrong: isWrong,
                bands: c.status === "none" ? [] : c.bands,
            });
            if (c.status !== "none") tally(def.key, "present");
            if (isWrong) tally(def.key, "wrong");
            if (isExpected) {
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
    const expectedKeys = BUFFS.map((b) => b.key).filter((k) => coverage.has(k) && coverage.get(k).expected > 0);
    return {
        paladins,
        expected: expectedKeys,
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
    for (const f of fights) {
        const b = f.buffs;
        if (!b || !Array.isArray(b.players)) continue;
        fightCount++;
        paladins = Math.max(paladins, b.paladins || 0);
        for (const p of b.players) {
            if (!byName.has(p.name)) byName.set(p.name, { name: p.name, type: p.type, roles: {}, fights: 0, buffs: {}, missing: 0, late: 0, partial: 0, wrong: 0 });
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
                if (c.status !== "none") cell.present++;
                if (c.wrong) cell.wrong++;
                if (c.expected) {
                    cell.expected++;
                    if (STATUSES.includes(c.status)) cell[c.status]++;
                }
            }
        }
        for (const c of b.coverage || []) {
            if (!byKey.has(c.key)) {
                const def = BUFFS.find((d) => d.key === c.key) || {};
                byKey.set(c.key, { key: c.key, label: def.label || c.key, groupLabel: def.groupLabel || "", icon: def.icon || "", provider: def.provider || "", group: def.group || "", expect: def.expect || "", fights: 0, slots: 0, full: 0, late: 0, partial: 0, none: 0, present: 0, wrong: 0, missingNames: new Set(), seenNames: new Set() });
            }
            const s = byKey.get(c.key);
            if (c.expected > 0) s.fights++;
            s.slots += c.expected;
            s.full += c.full;
            s.late += c.late || 0;
            s.partial += c.partial;
            s.none += c.none;
            s.present += c.present;
            s.wrong += c.wrong;
        }
        for (const p of b.players) {
            for (const c of p.buffs) {
                const s = byKey.get(c.key);
                if (!s) continue;
                if (c.status !== "none") s.seenNames.add(p.name);
                if (c.expected && c.status !== "full") s.missingNames.add(p.name);
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
        return { name: s.name, type: s.type, role, fights: s.fights, buffs, missing: s.missing, late: s.late, partial: s.partial, wrong: s.wrong };
    });
    const rows = BUFFS.map((b) => b.key).filter((k) => byKey.has(k)).map((k) => {
        const s = byKey.get(k);
        return {
            key: s.key, label: s.label, groupLabel: s.groupLabel, icon: s.icon, provider: s.provider, group: s.group, expect: s.expect,
            expected: s.slots > 0, fights: s.fights, slots: s.slots, full: s.full, late: s.late, partial: s.partial, none: s.none,
            present: s.present, wrong: s.wrong,
            coveragePct: s.slots ? Math.round((s.full / s.slots) * 100) : null,
            missingPlayers: s.missingNames.size,
            seenPlayers: s.seenNames.size,
        };
    });
    return { fights: fightCount, paladins, players, rows };
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
        row.buffs = buffsForFight({ fight: f, roster, bandsByName, deaths: row.deaths, icons });
        if (row.buffs) any = true;
    }
    return any ? summarize(timeline.fights) : null;
}

module.exports = { analyzeRaidBuffs, buffsForFight, summarize, buffRole, rosterFromSummary, rosterFromBands, statusOf, FULL_PCT };

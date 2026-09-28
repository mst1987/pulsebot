// The one-off switch of #524 (docs/raidplan/model.md, "The Standard of an event"): before #524 "Vorlage anwenden" wrote the rows of the
// template's Standard into EVERY boss and trash board of the event as copies (`origin: "default"`), so a healer swapped for the whole
// raid had to be swapped in every boss. This turns such copies into ONE row of the event's Standard (`bosses.defaults`) that the
// sections inherit again:
//
//   - copies that are the same in several sections (same type, task, assignees, targets RELATIVE to the section - "Tank 1 -> boss of
//     this section" - note, classes, picks ...) become one Standard row; the sections that hold it inherit it;
//   - a section whose copy differs keeps it as its deviation (`origin` = the new Standard row, the row switched off for it), a section
//     without the row switches it off - so nothing appears or disappears anywhere;
//   - rows without `origin: "default"` (made by hand, deviations of the template) stay exactly as they are;
//   - the EFFECTIVE rows of every section (raidplanInherit.effectiveRows) are checked against the rows the section had: a section where
//     they would differ in anything (content or order) keeps its board as it was and switches every Standard row off.
//
// Pure: the store (raidplanStore.migrateEventDefaults) reads, backs up, writes and logs; this only computes one plan.
const inherit = require("./raidplanInherit");
const board = require("./raidplanBoard");
const { newId } = require("../../utils/ids");

/** Whether a field says nothing (missing, empty, off): a row stored before a field existed reads like one that has it empty. */
const blank = (v) => v === undefined || v === null || v === false || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);

/** JSON with sorted keys and without empty fields: two rows with the same content give the same text, whatever order their fields were written in. */
function stable(v) {
    if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
    if (v && typeof v === "object") return `{${Object.keys(v).sort().filter((k) => !blank(v[k])).map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
    return JSON.stringify(v === undefined ? null : v);
}

/**
 * What a row IS, without where it sits: no id, no origin, no suggestion mark; a mob target by its reference and instance (name and icon
 * are a snapshot the section resolves again on every read).
 */
function signature(a) {
    const out = {};
    for (const [k, v] of Object.entries(a || {})) {
        if (k === "id" || k === "origin" || k === "suggested" || k === "_key") continue;
        out[k] = v;
    }
    out.targets = (a.targets || []).map((t) => (t.kind === "mob" ? { kind: "mob", ref: t.ref, n: t.n || 0, oid: t.oid || "" } : t));
    return stable(out);
}

/** A copy as the Standard row it came from: the boss of its section becomes "the boss of this section" again. */
function relativeRow(copy, key) {
    return {
        ...copy,
        targets: (copy.targets || []).map((t) => (t.kind === "mob" && t.ref === `b:${key}` ? { kind: "mob", ref: inherit.THIS_BOSS, name: "", icon: "", ...(t.n ? { n: t.n } : {}) } : t)),
    };
}

const rekeyed = (map, moved) => {
    const out = {};
    for (const [key, p] of Object.entries(map || {})) {
        const m = key.match(/^t:([\w-]+):(\d+)$/);
        out[m && moved.has(m[1]) ? `t:${moved.get(m[1])}:${m[2]}` : key] = p;
    }
    return out;
};

/**
 * Migrates the bosses of one plan. `sections` = the boss and trash entries of the event (raidplanStore.bossesForInstances, "Allgemein"
 * left out or not), `catalogMobs` = the catalog's mobs (the targets a Standard row can name). Returns null when there is nothing to do
 * (no copies, or the plan already has a Standard), else `{ bosses, rows, copies, deviations, kept }`: the new boards, how many Standard
 * rows were made, how many copies they replace, how many copies stay as deviations and how many sections kept their board unchanged.
 */
function migratePlan(bosses, sections, catalogMobs, { makeId = () => newId(5) } = {}) {
    const all = bosses && typeof bosses === "object" ? bosses : {};
    if (((all[inherit.DEFAULTS_KEY] || {}).assignments || []).length > 0) return null;
    const secs = (sections || []).filter((s) => s && inherit.inherits(s.key) && !s.general).map((s) => {
        const b = all[s.key] || {};
        const rows = b.assignments || [];
        const copies = rows.map((a, i) => ({ a, i })).filter((x) => x.a.origin === "default").map((x, n) => ({ ...x, n, sig: signature(x.a), taken: false }));
        return { meta: s, key: s.key, board: b, rows, copies, section: inherit.sectionOf(s, catalogMobs, b.mobs) };
    });
    const withCopies = secs.filter((s) => s.copies.length > 0).length;
    if (withCopies === 0) return null;

    // greedy: the candidate that the most sections hold unchanged first, as long as it is held by at least two and by more than half
    // of the sections that hold copies at all
    const promoted = [];
    for (let best = bestCandidate(secs); best && best.matches.size >= 2 && best.matches.size * 2 > withCopies; best = bestCandidate(secs)) {
        for (const hit of best.matches.values()) hit.taken = true;
        promoted.push(best);
    }
    if (promoted.length === 0) return null;

    // the Standard's order: where its copies stood (their place among the copies of a section, on average)
    const avg = (p) => [...p.matches.values()].reduce((sum, x) => sum + x.n, 0) / p.matches.size;
    promoted.sort((p, q) => avg(p) - avg(q));
    const std = board.cleanBoard({ assignments: promoted.map((p) => {
        const rest = { ...p.cand };
        delete rest._key;
        return { ...rest, id: makeId(), origin: "", suggested: false };
    }) }, { allowedUserIds: board.ANY_PLAYER }).board;
    const defaults = std.assignments;

    // a section without the row: a copy of the same type at the place the others hold it is its deviation
    promoted.forEach((p, i) => {
        const places = [...p.matches.values()].map((x) => x.n);
        const mode = places.sort((a, b) => places.filter((v) => v === b).length - places.filter((v) => v === a).length)[0];
        for (const s of secs) {
            if (p.matches.has(s.key)) continue;
            const dev = s.copies.find((x) => !x.taken && !x.dev && x.n === mode && x.a.type === defaults[i].type);
            if (dev) { dev.dev = defaults[i].id; }
        }
    });

    const out = { ...all, [inherit.DEFAULTS_KEY]: std };
    const counts = { rows: defaults.length, copies: 0, deviations: 0, kept: 0 };
    for (const s of secs) {
        const r = rebuildSection(s, promoted, defaults);
        out[s.key] = r.board;
        if (r.kept) counts.kept += 1;
        counts.copies += r.copies;
        counts.deviations += r.deviations;
    }
    return { bosses: out, ...counts };
}

/** The candidate (a copy read as a Standard row) that the most sections hold unchanged: `{ cand, matches: Map<key, copy> }`, null for none. */
function bestCandidate(secs) {
    let best = null;
    const tried = new Set();
    for (const s of secs) {
        for (const c of s.copies.filter((x) => !x.taken)) {
            const cand = relativeRow(c.a, s.key);
            const candSig = signature(cand);
            if (tried.has(candSig)) continue;
            tried.add(candSig);
            const matches = new Map();
            for (const t of secs) {
                const want = signature(inherit.resolveRow(cand, t.section));
                const hit = t.copies.find((x) => !x.taken && x.sig === want);
                if (hit) matches.set(t.key, hit);
            }
            if (!best || matches.size > best.matches.size) best = { cand, matches };
        }
    }
    return best;
}

const emptyWith = (inheritOff) => board.cleanBoard({ inheritOff }, { allowedUserIds: board.ANY_PLAYER }).board;

/**
 * One section after the switch: its copies of the Standard's rows gone (inherited again), a differing copy kept as the deviation, the
 * rows it lacks switched off, the moved tanks under the Standard rows' keys - and checked: when its rows would not read exactly as
 * before (content and order), it keeps its board and switches every Standard row off. `{ board, kept, copies, deviations }`.
 */
function rebuildSection(s, promoted, defaults) {
    const matchedBy = new Map();
    promoted.forEach((p, i) => { const hit = p.matches.get(s.key); if (hit) matchedBy.set(hit.a, defaults[i].id); });
    const devs = new Map(s.copies.filter((x) => x.dev).map((x) => [x.a, x.dev]));
    const moved = new Map();
    const assignments = [];
    for (const a of s.rows) {
        const to = matchedBy.get(a) || devs.get(a);
        if (to) moved.set(a.id, to);
        if (devs.has(a)) assignments.push({ ...a, origin: to });
        else if (!matchedBy.has(a)) assignments.push(a);
    }
    const inherited = new Set(matchedBy.values());
    const inheritOff = [...new Set([...(s.board.inheritOff || []), ...defaults.filter((d) => !inherited.has(d.id)).map((d) => d.id)])];
    const next = { ...s.board, assignments, inheritOff, autoPos: rekeyed(s.board.autoPos, moved), autoStyle: rekeyed(s.board.autoStyle, moved) };
    const same = stable(s.rows.map(signature)) === stable(inherit.mergeRows(defaults, next, s.section).map(signature));
    if (!same) {
        const off = [...new Set([...(s.board.inheritOff || []), ...defaults.map((d) => d.id)])];
        return { board: s.board.assignments ? { ...s.board, inheritOff: off } : emptyWith(off), kept: true, copies: 0, deviations: 0 };
    }
    return { board: s.board.assignments ? next : emptyWith(inheritOff), kept: false, copies: matchedBy.size, deviations: devs.size };
}

module.exports = { migratePlan, signature, relativeRow };

// The proposal as the editor (#263) reads it: groups with slots, the bench,
// the fulfilment checks — and for every raider the reasons, in German, why
// they are where they are ("Gr. 1 wegen Totem des Windzorns", "Bank: war
// zuletzt dabei"). Plain JSON only, so it can be stored with the event.

const { ROLES, ROLE_LABELS } = require("../../config/gameVersions/classes");
const { moreAvailableThanFirst } = require("./score");

const STATUS_TEXT = {
    late: "Kommt später",
    tentative: "Nur „Vielleicht“ angemeldet",
    bench: "Als Ersatz angemeldet",
};
// The same said *about the other character* of a choice (#320):
// "Mit Zibbowar als Heiler statt Zibbo (kommt später)".
const OTHER_STATUS_TEXT = {
    late: "kommt später",
    tentative: "nur „Vielleicht“ angemeldet",
    bench: "als Ersatz angemeldet",
};
const MAX_REASONS = 4;

const round = (v) => Math.round(v * 100) / 100;

function nameOf(model, idx, opt) {
    const c = model.cands[idx];
    const o = opt[idx] >= 0 ? c.options[opt[idx]] : c.options[0];
    return (o && o.character) || c.name || c.userId;
}

const ROLE_PLURAL = { tank: "Tanks", healer: "Heiler", melee: "Nahkämpfer", ranged: "Fernkämpfer" };

/**
 * Which of several named characters (#293) the raider plays, and why:
 * "Mit Zibbowar als Tank statt Zibbo (Tanks fehlten)", or "1. Wahl: Zibbo".
 * Null for a raider who named one character.
 */
function characterChoiceReason(model, facts, cand, o) {
    const pref = cand.preferred && cand.preferred.get(o.eventIdx);
    if (!pref) return null;
    if (!(o.priority > 0)) return `1. Wahl: ${o.character}`;
    const event = model.events[o.eventIdx];
    const ev = facts.events[o.eventIdx];
    const prefIdx = ROLES.indexOf(pref.role);
    const prefMax = event.hardMax[pref.role];
    let why = "passte besser in die Aufstellung";
    // The strongest explanation first: the raider said themselves that the first
    // choice is less available this evening (#320).
    if (moreAvailableThanFirst(cand, o) && OTHER_STATUS_TEXT[pref.status]) {
        why = OTHER_STATUS_TEXT[pref.status];
    } else if (pref.role !== o.role && prefIdx >= 0 && ev.roles[prefIdx] >= prefMax) {
        why = `${ROLE_PLURAL[pref.role]} voll (${ev.roles[prefIdx]}/${prefMax})`;
    } else if (ev.roles[o.roleIdx] <= event.limits[o.role].min && event.limits[o.role].min > 0) {
        why = `${ROLE_PLURAL[o.role]} fehlten`;
    }
    const same = String(pref.character).toLowerCase() === String(o.character).toLowerCase();
    return same
        ? `Als ${ROLE_LABELS[o.role]} statt 1. Wahl (${why})`
        : `Mit ${o.character} als ${ROLE_LABELS[o.role]} statt ${pref.character} (${why})`;
}

/** Reasons for a placed raider. */
function slotReasons(model, facts, state, c, credits) {
    const cand = model.cands[c];
    const o = cand.options[state.opt[c]];
    const out = [];
    if (state.lockOpt[c]) out.push("Von der Orga fixiert");
    const choice = characterChoiceReason(model, facts, cand, o);
    if (choice) out.push(choice);
    if (!o.main) out.push(`Zweitspec als ${ROLE_LABELS[o.role]}`);
    if (o.status === "bench") out.push("Als Ersatz angemeldet – aufgestellt, weil sonst ein Platz frei bliebe");
    else if (STATUS_TEXT[o.status]) out.push(STATUS_TEXT[o.status]);
    const g = state.grp[c] + 1;
    const mine = credits
        .filter((cr) => cr.member.cand.idx === c && !cr.buff.universal)
        .sort((a, b) => b.count - a.count || a.buff.idx - b.buff.idx);
    if (mine.length) {
        const top = mine[0];
        out.push(`Gr. ${g} wegen ${top.buff.label} (${top.count} profitieren)`);
    }
    // a raid buff nobody else in the raid brings
    const ev = facts.events[o.eventIdx];
    const event = model.events[o.eventIdx];
    for (const b of o.data.raid) {
        const others = ev.groups.flat().filter((m) => m.cand.idx !== c && m.opt.data.raid.includes(b)).length;
        if (others) continue;
        const buff = model.raidBuffs[b];
        const required = event.requiredRaid.includes(b);
        out.push(required ? `Bringt ${buff.label} (Pflicht-Buff)` : `Bringt als Einziger ${buff.label}`);
        break;
    }
    if (model.weightsEffective.fairness > 0) {
        if (cand.fairness.last === "bench") out.push("War zuletzt auf der Bank – hat Vorrang");
        else if (cand.fairness.benchCount >= 2) out.push(`${cand.fairness.benchCount}× auf der Bank in den letzten Raids`);
    }
    if (model.weightsEffective.wishes > 0) {
        for (const p of model.pairs) {
            if (p.a !== c && p.b !== c) continue;
            const other = p.a === c ? p.b : p.a;
            if (state.opt[other] < 0 || model.cands[other].options[state.opt[other]].eventIdx !== o.eventIdx) continue;
            if (state.grp[other] !== state.grp[c] && model.events.length === 1) continue;
            out.push(`Wunsch erfüllt: mit ${nameOf(model, other, state.opt)}${p.mutual ? " (gegenseitig)" : ""}`);
            break;
        }
    }
    if (cand.attendance !== null && cand.attendance >= 80 && model.weightsEffective.attendance > 0) out.push(`Anwesenheit ${Math.round(cand.attendance)} %`);
    if (model.events.length > 1) out.push(`Eingeteilt in ${event.title || event.id}`);
    if (!out.length) out.push("Angemeldet mit Hauptspec");
    return out.slice(0, MAX_REASONS + (state.lockOpt[c] ? 1 : 0));
}

/** Reasons for a raider on the bench. */
function benchReasons(model, facts, state, c) {
    const cand = model.cands[c];
    if (cand.fixed && cand.fixed.bench) return ["Von der Orga auf die Bank gesetzt"];
    if (!cand.options.length) {
        if (cand.noGear.length) return ["Keine Spec mit brauchbarem Gear"];
        if (cand.absentIn.size) return ["Abgemeldet"];
        return ["Keine Spezialisierung angegeben"];
    }
    const out = [];
    const full = new Set();
    for (const o of cand.options) {
        const event = model.events[o.eventIdx];
        const ev = facts.events[o.eventIdx];
        const max = event.hardMax[o.role];
        const count = ev.roles[o.roleIdx];
        if (count >= max) full.add(`${ROLE_LABELS[o.role]} voll (${count}/${max})`);
        else if (ev.count >= event.size) full.add(`Raid voll (${ev.count}/${event.size})`);
    }
    out.push(...full);
    const best = cand.options[0];
    if (best.status !== "signed" && STATUS_TEXT[best.status]) out.push(STATUS_TEXT[best.status]);
    if (model.weightsEffective.fairness > 0 && cand.fairness.last === "placed") out.push("War zuletzt dabei");
    if (cand.attendance !== null && cand.attendance < 50 && model.weightsEffective.attendance > 0) out.push(`Anwesenheit ${Math.round(cand.attendance)} %`);
    if (!out.length) out.push("Andere passten besser in die Aufstellung");
    return out.slice(0, MAX_REASONS);
}

function slotOf(model, state, c, reasons) {
    const cand = model.cands[c];
    const o = cand.options[state.opt[c]];
    return {
        userId: cand.userId,
        character: o.character,
        classId: o.classId,
        spec: o.spec,
        role: o.role,
        main: o.main,
        status: o.status,
        locked: !!state.lockOpt[c],
        reasons,
    };
}

function benchEntryOf(model, state, c, reasons) {
    const cand = model.cands[c];
    const o = cand.options.find((x) => x.main) || cand.options[0] || null;
    return {
        userId: cand.userId,
        character: o ? o.character : (cand.name || cand.userId),
        classId: o ? o.classId : "",
        spec: o ? o.spec : "",
        role: o ? o.role : "",
        status: o ? o.status : "",
        eventIds: [...new Set(cand.options.map((x) => model.events[x.eventIdx].id))],
        locked: !!(cand.fixed && cand.fixed.bench),
        reasons,
    };
}

function wishCheck(model, state, eventIdx) {
    const pairs = [];
    for (const p of model.pairs) {
        const a = model.cands[p.a];
        const b = model.cands[p.b];
        if (eventIdx !== null && !(a.signedIn.has(eventIdx) && b.signedIn.has(eventIdx))) continue;
        const oa = state.opt[p.a];
        const ob = state.opt[p.b];
        let met = oa >= 0 && ob >= 0 && a.options[oa].eventIdx === b.options[ob].eventIdx;
        if (eventIdx !== null) met = met && a.options[oa].eventIdx === eventIdx;
        if (met && model.events.length === 1) met = state.grp[p.a] === state.grp[p.b];
        pairs.push({ a: a.userId, b: b.userId, mutual: p.mutual, met });
    }
    return { met: pairs.filter((p) => p.met).length, total: pairs.length, pairs };
}

function eventChecks(model, facts, state, e) {
    const event = model.events[e];
    const ev = facts.events[e];
    const roles = {};
    for (let r = 0; r < ROLES.length; r++) {
        const { min, max } = event.limits[ROLES[r]];
        const count = ev.roles[r];
        roles[ROLES[r]] = { count, min, max, ok: count >= min && (max === null || count <= max) };
    }
    const size = { count: ev.count, size: event.size, ok: ev.count === event.size };
    const credited = new Map();
    for (const cr of ev.credits) {
        if (!credited.has(cr.buff.key)) credited.set(cr.buff.key, new Set());
        credited.get(cr.buff.key).add(state.grp[cr.member.cand.idx] + 1);
    }
    const required = event.requiredBuffs.map((key) => {
        const raid = model.raidBuffs.find((b) => b.key === key);
        const party = model.partyBuffs.find((b) => b.key === key);
        const buff = raid || party;
        if (!buff) return { key, label: key, present: false };
        const present = raid ? !!ev.raid[raid.idx] : !!ev.party[party.idx];
        return { key, label: buff.label, icon: buff.icon, present };
    });
    const buffs = {
        ok: required.every((b) => b.present),
        required,
        raid: model.raidBuffs.map((b) => ({ key: b.key, label: b.label, icon: b.icon, present: !!ev.raid[b.idx] })),
        party: model.partyBuffs
            .filter((b) => credited.has(b.key))
            .map((b) => ({ key: b.key, label: b.label, icon: b.icon, groups: [...credited.get(b.key)].sort((x, y) => x - y) })),
    };
    const wishes = wishCheck(model, state, e);
    return {
        ok: size.ok && Object.values(roles).every((r) => r.ok) && buffs.ok,
        size,
        roles,
        buffs,
        wishes,
    };
}

const ROLE_ORDER = Object.fromEntries(ROLES.map((r, i) => [r, i]));

/** Turn the searched state into the serializable proposal. */
function buildOutput(model, scorer, state, { version, weights }) {
    model.weightsEffective = weights;
    const facts = scorer.breakdown(state.opt, state.grp);
    const events = model.events.map((event, e) => {
        const ev = facts.events[e];
        const groups = ev.groups.map((members, g) => ({
            index: g + 1,
            slots: members
                .slice()
                .sort((a, b) => ROLE_ORDER[a.opt.role] - ROLE_ORDER[b.opt.role] || a.cand.idx - b.cand.idx)
                .map((m) => slotOf(model, state, m.cand.idx, slotReasons(model, facts, state, m.cand.idx, ev.credits))),
        }));
        const bench = model.cands
            .filter((c) => state.opt[c.idx] < 0)
            .filter((c) => c.options.some((o) => o.eventIdx === e) || (c.signedIn.has(e) && !c.absentIn.has(e)))
            .map((c) => benchEntryOf(model, state, c.idx, benchReasons(model, facts, state, c.idx)));
        return {
            eventId: event.id,
            title: event.title,
            groups,
            bench,
            checks: eventChecks(model, facts, state, e),
        };
    });
    const bench = model.cands
        .filter((c) => state.opt[c.idx] < 0 && c.options.length + (c.fixed && c.fixed.bench ? 1 : 0) + c.noGear.length > 0)
        .map((c) => benchEntryOf(model, state, c.idx, benchReasons(model, facts, state, c.idx)));
    const first = events[0] || { groups: [], checks: { ok: false, size: { count: 0, size: 0, ok: false }, roles: {}, buffs: { ok: true, required: [], raid: [], party: [] }, wishes: { met: 0, total: 0, pairs: [] } } };
    const wishes = model.events.length > 1 ? wishCheck(model, state, null) : first.checks.wishes;
    const parts = Object.fromEntries(Object.entries(facts ? facts.parts : {}).map(([k, v]) => [k, round(v)]));
    return {
        version,
        versionId: model.versionId,
        groups: first.groups,
        bench,
        checks: { ...first.checks, ok: events.every((e) => e.checks.ok), wishes },
        events,
        weights,
        score: { total: round(facts ? facts.total : 0), parts },
        warnings: model.warnings,
    };
}

module.exports = { buildOutput, slotReasons, benchReasons, eventChecks };

// The proposal as the editor (#263) reads it: groups with slots, the bench,
// the fulfilment checks — and for every raider the reasons, in German, why
// they are where they are ("Gr. 1 wegen Totem des Windzorns", "Bank: war
// zuletzt dabei"). Plain JSON only, so it can be stored with the event.

const { ROLES, ROLE_LABELS } = require("../../config/gameVersions/classes");
const { moreAvailableThanFirst } = require("./score");
const { SPEC_PREFIX } = require("./lootWants");
const { raidStrengths, CLASS_OF_ROLE, CLASSES } = require("./raidStrength");

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
 * A fixed place (`byOrga`) on a further character was the orga's own pick:
 * "Mit Zibbowar als Tank (von der Orga gewählt)".
 * Null for a raider who named one character.
 */
function characterChoiceReason(model, facts, cand, o, byOrga = false) {
    const pref = cand.preferred && cand.preferred.get(o.eventIdx);
    if (!pref) return null;
    if (!(o.priority > 0)) return `1. Wahl: ${o.character}`;
    if (byOrga) return `Mit ${o.character} als ${ROLE_LABELS[o.role]} (von der Orga gewählt)`;
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

/** How the raider signed up: fixed, which character, off spec, status. */
function signupReasons(model, facts, state, c, out) {
    const cand = model.cands[c];
    const o = cand.options[state.opt[c]];
    if (state.lockOpt[c]) out.push("Von der Orga fixiert");
    const choice = characterChoiceReason(model, facts, cand, o, !!state.lockOpt[c]);
    if (choice) out.push(choice);
    if (!o.main) out.push(`Zweitspec als ${ROLE_LABELS[o.role]}`);
    if (o.status === "bench") out.push("Als Ersatz angemeldet – aufgestellt, weil sonst ein Platz frei bliebe");
    else if (STATUS_TEXT[o.status]) out.push(STATUS_TEXT[o.status]);
}

/** The group buff the raider brings most raiders, and a raid buff nobody else in the raid brings. */
function buffReasons(model, facts, state, c, credits, out) {
    const o = model.cands[c].options[state.opt[c]];
    const mine = credits
        .filter((cr) => cr.member.cand.idx === c && !cr.buff.universal)
        .sort((a, b) => b.count - a.count || a.buff.idx - b.buff.idx);
    if (mine.length) out.push(`Gr. ${state.grp[c] + 1} wegen ${mine[0].buff.label} (${mine[0].count} profitieren)`);
    const ev = facts.events[o.eventIdx];
    const event = model.events[o.eventIdx];
    for (const b of o.data.raid) {
        const others = ev.groups.flat().filter((m) => m.cand.idx !== c && m.opt.data.raid.includes(b)).length;
        if (others) continue;
        const buff = model.raidBuffs[b];
        out.push(event.requiredRaid.includes(b) ? `Bringt ${buff.label} (Pflicht-Buff)` : `Bringt als Einziger ${buff.label}`);
        break;
    }
}

/** Reasons for a placed raider. */
function slotReasons(model, facts, state, c, credits, lootAt = null) {
    const cand = model.cands[c];
    const o = cand.options[state.opt[c]];
    const event = model.events[o.eventIdx];
    const out = [];
    signupReasons(model, facts, state, c, out);
    buffReasons(model, facts, state, c, credits, out);
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
    closingReasons(model, state, c, lootAt, event, out);
    if (!out.length) out.push("Angemeldet mit Hauptspec");
    return out.slice(0, MAX_REASONS + (state.lockOpt[c] ? 1 : 0));
}

/** Loot (#1037, only where it is on), attendance and the raid; "Wegen Loot in PuG 3" names the raid itself. */
function closingReasons(model, state, c, lootAt, event, out) {
    const cand = model.cands[c];
    const loot = model.weightsEffective.loot > 0 ? lootReason(model, state, lootAt, c) : null;
    if (loot && !loot.raid) out.push(loot.text);
    if (cand.attendance !== null && cand.attendance >= 80 && model.weightsEffective.attendance > 0) out.push(`Anwesenheit ${Math.round(cand.attendance)} %`);
    if (loot && loot.raid) out.push(loot.text);
    else if (model.events.length > 1) out.push(`Eingeteilt in ${event.title || event.id}`);
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
    // the character the orga put on the bench (#293), else the first main option
    const wanted = cand.fixed && cand.fixed.bench ? String(cand.fixed.character || "").toLowerCase() : "";
    const chosen = wanted ? cand.options.find((x) => x.main && String(x.character).toLowerCase() === wanted) : null;
    const o = chosen || cand.options.find((x) => x.main) || cand.options[0] || null;
    return {
        userId: cand.userId,
        character: o ? o.character : (cand.name || cand.userId),
        classId: o ? o.classId : "",
        spec: o ? o.spec : "",
        role: o ? o.role : "",
        status: o ? o.status : "",
        eventIds: [...new Set(cand.options.map((x) => model.events[x.eventIdx].id))],
        locked: !!(cand.fixed && cand.fixed.bench && cand.fixed.locked),
        reasons,
    };
}

/**
 * The raiders nobody placed (#517), split: the **bench** is only who the orga put
 * there (`fixed.bench`), everybody else signed up and not placed is the **pool**
 * ("Angemeldet") — a proposal never benches anybody on its own.
 */
function unplacedOf(model, facts, state, filter) {
    const bench = [];
    const pool = [];
    for (const c of model.cands) {
        if (state.opt[c.idx] >= 0 || !filter(c)) continue;
        const entry = benchEntryOf(model, state, c.idx, benchReasons(model, facts, state, c.idx));
        if (c.fixed && c.fixed.bench) bench.push(entry);
        else pool.push({ ...entry, locked: false });
    }
    return { bench, pool };
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

/**
 * "Nicht zusammen" pairs: how many there are among the signups and how many
 * still stand together (same group in one raid, same raid when raids run in
 * parallel). Counts only — who named whom never leaves the store.
 */
function avoidCheck(model, state) {
    let together = 0;
    for (const p of model.avoidPairs || []) {
        const oa = state.opt[p.a];
        const ob = state.opt[p.b];
        if (oa < 0 || ob < 0) continue;
        if (model.cands[p.a].options[oa].eventIdx !== model.cands[p.b].options[ob].eventIdx) continue;
        if (model.events.length === 1 && state.grp[p.a] !== state.grp[p.b]) continue;
        together++;
    }
    return { on: model.avoidOverride === true, together, total: (model.avoidPairs || []).length };
}

/**
 * Who wants which loot where (#1037): `[event][item] → candidate indexes`, placed raiders
 * only (the bench and the pool never count). Null without loot.
 */
function lootPlacement(model, state) {
    if (!model.lootOn) return null;
    const byEvent = model.events.map(() => new Map());
    for (const c of model.cands) {
        const o = state.opt[c.idx];
        if (o < 0) continue;
        const option = c.options[o];
        if (!option.loot) continue;
        const map = byEvent[option.eventIdx];
        for (const want of option.loot) {
            if (!map.has(want.i)) map.set(want.i, []);
            map.get(want.i).push(c.idx);
        }
    }
    return byEvent;
}

/** An item's display name: the stored one, the spec's label for the spec fallback, else its id. */
function lootItemName(model, item) {
    if (item.spec) {
        const key = String(item.itemId).slice(SPEC_PREFIX.length);
        const spec = model.specInfo.get(key);
        return (spec && spec.label) || key;
    }
    return item.name || `Item ${item.itemId}`;
}

/** How many placed raiders each source covers. */
function lootSources(model, state) {
    const sources = { softres: 0, bis: 0, spec: 0, none: 0 };
    for (const c of model.cands) {
        const o = state.opt[c.idx];
        if (o < 0) continue;
        const src = c.options[o].lootSource;
        sources[src && sources[src] !== undefined ? src : "none"]++;
    }
    return sources;
}

/** One raid of a listed item: who wants it there, with the source of the wish. */
function lootRaidOf(model, state, e, list) {
    const event = model.events[e];
    return {
        eventId: event.id,
        title: event.title || event.id,
        raiders: list.map((c) => {
            const o = model.cands[c].options[state.opt[c]];
            return { userId: model.cands[c].userId, character: o.character, source: o.lootSource || "" };
        }),
    };
}

/**
 * `checks.loot`: the real items (Softres, BiS minus gear) more than one placed raider wants
 * in the same raid, each with every raid it is wanted in and who wants it there, and how many
 * placed raiders each source covers. `conflicts` is the number of listed items, so the summary
 * matches the list. Spec overlaps (the fallback without data) only weigh in the score: they name
 * no item the orga could check. Only with loot on - otherwise the checks keep their old shape.
 */
function lootCheck(model, state, placement) {
    const byItem = new Map();
    placement.forEach((map, e) => {
        for (const [i, list] of map) {
            if (model.loot.items[i].spec) continue;
            if (!byItem.has(i)) byItem.set(i, { count: 0, eventIds: [], conflictIn: [], raids: [] });
            const entry = byItem.get(i);
            entry.count += list.length;
            entry.eventIds.push(model.events[e].id);
            entry.raids.push(lootRaidOf(model, state, e, list));
            if (list.length > 1) entry.conflictIn.push(model.events[e].id);
        }
    });
    const items = [];
    for (const [i, entry] of byItem) {
        if (!entry.conflictIn.length) continue;
        const item = model.loot.items[i];
        items.push({ itemId: item.itemId, name: lootItemName(model, item), icon: item.icon, quality: item.quality, ...entry });
    }
    items.sort((a, b) => b.conflictIn.length - a.conflictIn.length || b.count - a.count || String(a.itemId).localeCompare(String(b.itemId)));
    return { on: true, conflicts: items.length, items, sources: lootSources(model, state) };
}

/**
 * The loot reason of a placed raider (#1037): the item they share with nobody in their raid
 * while somebody in another raid wants it - in the first such raid "Als Einziger im Raid an
 * Zwillingsklinge interessiert", in a later one "In PuG 3, weil Zwillingsklinge in PuG 1 schon
 * gewollt wird"; for the spec fallback (no item to name) "In PuG 3, weil in PuG 1 schon jemand mit derselben Spec
 * Loot braucht". Null when loot is off or explains nothing. `kind`, `item`, `raid` and `other` let the
 * web client say it in the page's language (`text` is the German reason in `reasons`).
 */
function lootReason(model, state, placement, c) {
    if (!placement) return null;
    const o = model.cands[c].options[state.opt[c]];
    if (!o.loot) return null;
    const elsewhere = (want) => placement.findIndex((map, e) => e !== o.eventIdx && map.has(want.i));
    const best = o.loot
        .filter((want) => {
            const here = placement[o.eventIdx].get(want.i);
            return !!here && here.length === 1 && elsewhere(want) >= 0;
        })
        .sort((a, b) => b.w - a.w || a.i - b.i)[0];
    if (!best) return null;
    const item = model.loot.items[best.i];
    const titleOf = (e) => model.events[e].title || model.events[e].id;
    if (item.spec) {
        const raid = titleOf(o.eventIdx);
        const other = titleOf(elsewhere(best));
        const text = `In ${raid}, weil in ${other} schon jemand mit derselben Spec Loot braucht`;
        return { text, raid: true, field: { kind: "spec", text, raid, other } };
    }
    const name = lootItemName(model, item);
    const before = placement.findIndex((map, e) => e < o.eventIdx && map.has(best.i));
    if (before >= 0) {
        const raid = titleOf(o.eventIdx);
        const other = titleOf(before);
        const text = `In ${raid}, weil ${name} in ${other} schon gewollt wird`;
        return { text, raid: true, field: { kind: "raid", text, item: name, raid, other } };
    }
    const text = `Als Einziger im Raid an ${name} interessiert`;
    return { text, raid: false, field: { kind: "only", text, item: name } };
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
    // one leader per raid (#1036), only where the input names who may lead
    const leader = event.leaderRule ? leaderCheck(model, state, e) : null;
    return {
        ok: size.ok && Object.values(roles).every((r) => r.ok) && buffs.ok && (!leader || leader.ok),
        size,
        roles,
        buffs,
        wishes,
        ...(leader ? { leader } : {}),
    };
}

const ROLE_ORDER = Object.fromEntries(ROLES.map((r, i) => [r, i]));

/**
 * The raider who leads event e (#1036), or -1, while placed there: the orga's choice
 * (`leaderUserId`), else the raid lead entered in the event (`raidLeadId`), else the
 * first placed raider who may lead it, by signup order. Only under a leader rule:
 * without one (no fitting leader flag in reach of the server) nobody is marked - not
 * the raid lead, not an orga choice - so the setup and its signatures stay exactly as
 * before #1036. Several may lead; exactly one is marked.
 */
function leaderOf(model, state, e) {
    const event = model.events[e];
    if (!event.leaderRule) return -1;
    let chosen = -1;
    let lead = -1;
    let first = -1;
    for (const c of model.cands) {
        const o = state.opt[c.idx];
        if (o < 0 || c.options[o].eventIdx !== e) continue;
        if (event.leaderUserId && c.userId === event.leaderUserId) chosen = c.idx;
        else if (event.raidLeadId && c.userId === event.raidLeadId) lead = c.idx;
        else if (first < 0 && c.leadsIn && c.leadsIn.has(e)) first = c.idx;
    }
    if (chosen >= 0) return chosen;
    return lead >= 0 ? lead : first;
}

/** The leader check of event e: placed leaders, ok with at least one, and who of the signups may lead. */
function leaderCheck(model, state, e) {
    let count = 0;
    const candidates = [];
    for (const c of model.cands) {
        if (!c.leadsIn || !c.leadsIn.has(e)) continue;
        candidates.push(c.userId);
        const o = state.opt[c.idx];
        if (o >= 0 && c.options[o].eventIdx === e) count++;
    }
    return { count, ok: count >= 1, candidates };
}

/** The leader's slot: `leader: true` and the reason right after a fixed place. */
function markLeader(slot, event) {
    const reason = `Leitet diesen Raid (${event.instanceShort || event.title || event.id})`;
    const at = slot.reasons[0] === "Von der Orga fixiert" ? 1 : 0;
    return { ...slot, leader: true, reasons: [...slot.reasons.slice(0, at), reason, ...slot.reasons.slice(at)] };
}

/**
 * `checks.balance` (#1038): the mean strength (0-100) of every parallel raid's placed raiders and
 * the spread between the strongest and the weakest; `known` = raiders with any data behind it.
 */
function balanceCheck(model, state) {
    const n = model.events.length;
    const sum = new Float64Array(n * CLASSES);
    const count = new Float64Array(n * CLASSES);
    const placed = new Array(n).fill(0);
    for (const c of model.cands) {
        const o = state.opt[c.idx];
        if (o < 0) continue;
        const option = c.options[o];
        const k = option.eventIdx * CLASSES + CLASS_OF_ROLE[option.roleIdx];
        sum[k] += option.strength;
        count[k] += 1;
        placed[option.eventIdx]++;
    }
    const { spread, strengths } = raidStrengths(sum, count, n);
    return {
        spread,
        known: model.strengthKnown || 0,
        // placed/size: "Raids ausgeglichen" only with every raid filled - else the editor names the short one
        raids: model.events.map((event, e) => ({ eventId: event.id, strength: strengths[e], placed: placed[e], size: event.size })),
    };
}

/** The slot with its `lootReason` (#1037) when one stands in its reasons - no key otherwise. */
function withLootReason(slot, model, state, lootAt, c) {
    const loot = lootAt ? lootReason(model, state, lootAt, c) : null;
    return loot && slot.reasons.includes(loot.text) ? { ...slot, lootReason: loot.field } : slot;
}

/** Turn the searched state into the serializable proposal. */
function buildOutput(model, scorer, state, { version, weights }) {
    model.weightsEffective = weights;
    const facts = scorer.breakdown(state.opt, state.grp);
    // loot (#1037): reasons and `checks.loot` only where it weighs - else the output stays as before
    const lootAt = weights.loot > 0 ? lootPlacement(model, state) : null;
    const events = model.events.map((event, e) => {
        const ev = facts.events[e];
        const leader = leaderOf(model, state, e);
        const groups = ev.groups.map((members, g) => ({
            index: g + 1,
            slots: members
                .slice()
                .sort((a, b) => ROLE_ORDER[a.opt.role] - ROLE_ORDER[b.opt.role] || a.cand.idx - b.cand.idx)
                .map((m) => {
                    const slot = withLootReason(slotOf(model, state, m.cand.idx, slotReasons(model, facts, state, m.cand.idx, ev.credits, lootAt)), model, state, lootAt, m.cand.idx);
                    return m.cand.idx === leader ? markLeader(slot, event) : slot;
                }),
        }));
        const { bench, pool } = unplacedOf(model, facts, state, (c) => c.options.some((o) => o.eventIdx === e) || (c.signedIn.has(e) && !c.absentIn.has(e)));
        return {
            eventId: event.id,
            title: event.title,
            groups,
            bench,
            pool,
            checks: eventChecks(model, facts, state, e),
        };
    });
    const { bench, pool } = unplacedOf(model, facts, state, (c) => c.options.length + (c.fixed && c.fixed.bench ? 1 : 0) + c.noGear.length > 0);
    const first = events[0] || { groups: [], checks: { ok: false, size: { count: 0, size: 0, ok: false }, roles: {}, buffs: { ok: true, required: [], raid: [], party: [] }, wishes: { met: 0, total: 0, pairs: [] } } };
    const wishes = model.events.length > 1 ? wishCheck(model, state, null) : first.checks.wishes;
    const parts = Object.fromEntries(Object.entries(facts ? facts.parts : {}).map(([k, v]) => [k, round(v)]));
    const checks = { ...first.checks, ok: events.every((e) => e.checks.ok), wishes, avoid: avoidCheck(model, state) };
    if (lootAt) checks.loot = lootCheck(model, state, lootAt);
    // balance (#1038): parallel raids with strength data, the weight 0 included - the weight only
    // switches the balancing off, the editor still shows how strong the raids are. Not signed.
    if (model.balanceOn && model.strengthKnown > 0) checks.balance = balanceCheck(model, state);
    // No word about a shadowban (Vermerke, #981) in the output: it is stored as the setup (also as an
    // automatic draft, eventStore.saveSetupDraft). The orga's answer names them (web/apiRoutes/events/setup.js).
    return {
        version,
        versionId: model.versionId,
        groups: first.groups,
        bench,
        pool,
        checks,
        events,
        weights,
        score: { total: round(facts ? facts.total : 0), parts },
        warnings: model.warnings,
    };
}

module.exports = { buildOutput, slotReasons, benchReasons, eventChecks };

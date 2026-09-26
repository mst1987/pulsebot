// The setup of an own event (#263): proposal, manual changes, approval — and
// what everyone who is *not* the orga may see of it.
//
// ⚠️ The setup is always only a proposal until a human with `raids` write
// approves it. Raiders never see a draft: every reader outside the editor
// (signup page, event message, bot lookups, sheet fill) goes through
// setupCore.approvedSetupOf() / approvedPlacementFor() / raidHelperSlots(),
// which only ever read the frozen `approved` snapshot.
//
// Stored on the event (eventStore.setEventSetup) as one object:
//   status              "draft" | "approved"
//   version             bumps on every proposal and every change of the lineup
//   groups, bench, checks, weights, score, warnings, historySource
//                       the proposal's output v1 (utils/setup/proposal.js) for the
//                       event — a manual change is valued by evaluateSetup(), so
//                       both read alike
//   options             { weights, fairness, wishes, avoid } the orga set for this event
//   origin              "proposal" | "manual" — what produced the current lineup
//   updatedAt/By
//   approvedAt/By/Version
//   approved            the last approved lineup (names, specs, groups; no reasons),
//                       kept while a changed draft waits for the next approval
//   changedSinceApproval  a draft that differs from an earlier approval
//   explanation         { text, model, at, version } from Claude (explainText.js)
const eventStore = require("../stores/eventStore");
const { collectSetupInput, proposeSetup } = require("./setupInput");
const { specNameFor } = require("./eventSources");
const { evaluateSetup } = require("../utils/setup/proposal");
const { validatePlacement, placeSlots } = require("../utils/setup/manual");
const { DEFAULT_WEIGHTS, MAX_WEIGHT } = require("../utils/setup/score");
const { rulesFor, DEFAULT_VERSION } = require("../config/gameVersions");
const { str } = require("../utils/text");
const { approvedSetupOf, pingTextOf } = require("./setupCore");
const { suggestSearch } = require("./raidSearch");


function fail(code, error) {
    return { code, error };
}

/** The weights the orga overrode (only known keys, clamped), `{}` for none. */
function cleanWeights(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const key of Object.keys(DEFAULT_WEIGHTS)) {
        if (raw[key] === undefined || raw[key] === null || raw[key] === "") continue;
        const n = Number(raw[key]);
        if (Number.isFinite(n)) out[key] = Math.max(0, Math.min(MAX_WEIGHT, Math.round(n)));
    }
    return out;
}

/** The run options: what the body says, else what the event's setup remembered. */
function mergeOptions(body = {}, previous = {}) {
    const prev = previous || {};
    return {
        weights: body.weights !== undefined ? cleanWeights(body.weights) : cleanWeights(prev.weights),
        fairness: typeof body.fairness === "boolean" ? body.fairness : (typeof prev.fairness === "boolean" ? prev.fairness : null),
        wishes: typeof body.wishes === "boolean" ? body.wishes : (typeof prev.wishes === "boolean" ? prev.wishes : null),
        // "nicht zusammen" has no event flag: null = never asked (the editor asks), off until yes
        avoid: typeof body.avoid === "boolean" ? body.avoid : (typeof prev.avoid === "boolean" ? prev.avoid : null),
    };
}

/** The options as buildSetupProposal()/evaluateSetup() take them (null = the event's flag). */
function runOptions(options, extra = {}) {
    const out = { ...extra, weights: options.weights };
    if (typeof options.fairness === "boolean") out.fairness = options.fairness;
    if (typeof options.wishes === "boolean") out.wishes = options.wishes;
    if (options.avoid === true) out.avoid = true;
    return out;
}

/**
 * How many "nicht zusammen" pairs stand among the event's signups — the number
 * the editor asks about before a proposal. Only raiders who have the list
 * switched on count, and only the count leaves this function.
 */
function avoidPairCount(signups, profileList) {
    const signed = new Set((signups || []).filter((s) => s.status !== "absence").map((s) => str(s.userId)));
    const seen = new Set();
    for (const p of profileList || []) {
        if (!signed.has(str(p.userId)) || p.avoidEnabled !== true) continue;
        for (const other of p.avoid || []) {
            if (!signed.has(str(other))) continue;
            seen.add([str(p.userId), str(other)].sort().join("|"));
        }
    }
    return seen.size;
}

/**
 * Who stands where — what a raider would notice, the order inside a group
 * included (the setup message lists a group in that order). Locks and weights
 * are not part of it.
 */
function lineupSignature(setup) {
    if (!setup) return "";
    const groups = (setup.groups || [])
        .map((g) => `${g.index}:${(g.slots || []).map((s) => `${s.userId}/${String(s.character || "").toLowerCase()}/${s.spec}/${s.role}`).join(",")}`)
        .sort();
    return groups.join("|");
}

/** The frozen, raider-facing copy of a lineup: names, specs, groups — no reasons, no wishes. */
function snapshotOf(setup, { at, by }) {
    const person = (x) => ({ userId: String(x.userId), character: x.character || "", classId: x.classId || "", spec: x.spec || "", role: x.role || "", ...(x.pos ? { pos: x.pos } : {}) });
    return {
        version: setup.version,
        approvedAt: at,
        approvedBy: by,
        groups: (setup.groups || []).map((g) => ({ index: g.index, slots: (g.slots || []).map(person) })),
        bench: (setup.bench || []).map(person),
    };
}

/** The proposal output reduced to what is stored for one event. */
function stored(result) {
    return {
        proposalVersion: result.version,
        versionId: result.versionId,
        groups: result.groups,
        bench: result.bench,
        checks: result.checks,
        weights: result.weights,
        score: result.score,
        warnings: result.warnings || [],
        historySource: result.historySource || "",
    };
}

/** The next stored setup after a proposal or a change of the lineup. */
function nextSetup(prev, result, { origin, options, userId, now }) {
    const changed = !prev || lineupSignature(prev) !== lineupSignature(result);
    const base = {
        ...(prev || {}),
        ...stored(result),
        options,
        updatedAt: now,
        updatedBy: str(userId),
    };
    if (!changed) {
        // Same lineup (a lock, a weight, fairness switched): an approval stands.
        return { ...base, origin: prev.origin || origin, version: prev.version || 1 };
    }
    return {
        ...base,
        origin,
        version: ((prev && prev.version) || 0) + 1,
        status: "draft",
        approved: (prev && prev.approved) || null,
        changedSinceApproval: !!(prev && prev.approved),
        approvedAt: 0,
        approvedBy: "",
        approvedVersion: 0,
        explanation: (prev && prev.explanation) || null,
    };
}

function ownEvent(eventId) {
    const event = eventStore.getEvent(eventId);
    if (!event) return { failed: fail(eventStore.isOwnEventId(eventId) ? "not_found" : "raidhelper", eventStore.isOwnEventId(eventId) ? "Event nicht gefunden." : "Das Setup dieses Events liegt bei Raid-Helper.") };
    return { event };
}

/**
 * A fresh proposal for the event, keeping the places locked in its current
 * draft (setupInput.fixedFromSetup). Stored as a draft.
 * @returns {{ setup?: object, event?: object, error?: string, code?: string }}
 */
function proposeEventSetup(eventId, body = {}, { userId = "", now = Date.now() } = {}) {
    const { event, failed } = ownEvent(eventId);
    if (failed) return failed;
    const options = mergeOptions(body, event.setup && event.setup.options);
    const result = proposeSetup([event.id], runOptions(options, { now }));
    if (!result) return fail("not_found", "Event nicht gefunden.");
    const setup = nextSetup(event.setup, result, { origin: "proposal", options, userId, now });
    // A proposal that lands on the approved lineup again leaves the approval standing.
    const saved = eventStore.setEventSetup(event.id, setup);
    return { setup: saved.setup, event: saved };
}

/**
 * The valued groups in the order the orga placed them: the evaluation sorts a
 * group by role, but the orga may have arranged it (the editor's places 1–5) —
 * and each raider keeps the place (`pos`) they were put on.
 */
function inPlacedOrder(groups, placed) {
    const rank = new Map();
    const place = new Map();
    for (const g of placed || []) {
        (g.slots || []).forEach((s, i) => {
            rank.set(`${g.index}:${String(s.userId)}`, i);
            place.set(`${g.index}:${String(s.userId)}`, s.pos);
        });
    }
    const key = (index, s) => `${index}:${String(s.userId)}`;
    const at = (index, s) => (rank.has(key(index, s)) ? rank.get(key(index, s)) : Infinity);
    return (groups || []).map((g) => ({
        ...g,
        slots: (g.slots || []).slice().sort((a, b) => at(g.index, a) - at(g.index, b)).map((s) => ({ ...s, pos: place.get(key(g.index, s)) })),
    }));
}

/**
 * The orga's own lineup: validated, valued like a proposal and stored. A change
 * of who stands where turns an approved setup back into a draft
 * ("geändert seit Freigabe"); a lock or a weight alone does not.
 * `body.version` (optional) must match the stored version, so two orga members
 * editing at once cannot silently overwrite each other.
 */
function saveEventSetup(eventId, body = {}, { userId = "", now = Date.now() } = {}) {
    const { event, failed } = ownEvent(eventId);
    if (failed) return failed;
    const prev = event.setup;
    if (body.version !== undefined && body.version !== null && prev && Number(body.version) !== Number(prev.version)) {
        return fail("conflict", "Das Setup wurde inzwischen geändert – bitte neu laden.");
    }
    const input = collectSetupInput([event.id], { now });
    if (!input) return fail("not_found", "Event nicht gefunden.");
    const checked = validatePlacement(body, { event, signups: input.signups });
    if (checked.error) return fail("invalid", checked.error);
    const options = mergeOptions(body, prev && prev.options);
    let result;
    try {
        result = evaluateSetup(input, checked.value, runOptions(options));
    } catch (e) {
        return fail("invalid", e.message || "Ungültige Aufstellung.");
    }
    const placedIds = new Set(checked.value.groups.flatMap((g) => g.slots.map((s) => s.userId)));
    const got = new Set(result.groups.flatMap((g) => g.slots.map((s) => String(s.userId))));
    const lost = [...placedIds].filter((id) => !got.has(id));
    if (lost.length) return fail("invalid", `Nicht platzierbar: ${lost.join(", ")}.`);
    const groups = inPlacedOrder(result.groups, checked.value.groups);
    const setup = nextSetup(prev, { ...result, groups, historySource: input.historySource }, { origin: "manual", options, userId, now });
    const saved = eventStore.setEventSetup(event.id, setup);
    return { setup: saved.setup, event: saved };
}

/**
 * Approve the current draft. Only what the editor showed may be approved:
 * `version` must match. Approving an approved setup changes nothing.
 */
function approveEventSetup(eventId, { version, userId = "", now = Date.now() } = {}) {
    const { event, failed } = ownEvent(eventId);
    if (failed) return failed;
    const setup = event.setup;
    if (!setup || !(setup.groups || []).some((g) => (g.slots || []).length)) return fail("no_setup", "Es gibt noch kein Setup zum Freigeben.");
    if (version !== undefined && version !== null && Number(version) !== Number(setup.version)) {
        return fail("conflict", "Das Setup wurde inzwischen geändert – bitte neu laden und erneut prüfen.");
    }
    if (setup.status === "approved") return { setup, event, already: true };
    const approved = {
        ...setup,
        status: "approved",
        changedSinceApproval: false,
        approvedAt: now,
        approvedBy: str(userId),
        approvedVersion: setup.version,
        approved: snapshotOf(setup, { at: now, by: str(userId) }),
    };
    const saved = eventStore.setEventSetup(event.id, approved);
    return { setup: saved.setup, event: saved };
}

/** Remember Claude's explanation for the setup version it was written for. */
function storeExplanation(eventId, { text, model, version, now = Date.now() }) {
    const event = eventStore.getEvent(eventId);
    if (!event || !event.setup) return null;
    const saved = eventStore.setEventSetup(event.id, { ...event.setup, explanation: { text, model, version, at: now } });
    return saved && saved.setup;
}

// ---- what everyone else may see -------------------------------------------

/**
 * Where the approved setup puts one raider: `{ group, character, spec, role }`,
 * `{ bench: true, character, spec, role }`, or null (no approved setup, or not in it).
 */
function approvedPlacementFor(event, userId) {
    const approved = approvedSetupOf(event);
    if (!approved) return null;
    const uid = str(userId);
    for (const g of approved.groups) {
        const slot = (g.slots || []).find((s) => s.userId === uid);
        if (slot) return { group: g.index, character: slot.character, spec: slot.spec, role: slot.role };
    }
    const bench = (approved.bench || []).find((b) => b.userId === uid);
    return bench ? { bench: true, character: bench.character, spec: bench.spec, role: bench.role } : null;
}

/**
 * The approved lineup as Raid-Helper raidplan slots — for the readers built on
 * that shape (the bot's setup lookups, utils/setup/fillSetup.js). [] without approval.
 */
function raidHelperSlots(event) {
    const approved = approvedSetupOf(event);
    if (!approved) return [];
    return approved.groups.flatMap((g) => (g.slots || []).map((s, i) => ({
        id: s.userId,
        userid: s.userId,
        userId: s.userId,
        name: s.character,
        specName: specNameFor(s.spec),
        className: s.classId,
        groupNumber: g.index,
        slotNumber: i + 1,
    })));
}

/** What the raid detail's progress step needs — counts and state, no names. */
function setupSummary(event) {
    const setup = event && event.setup;
    if (!setup) return null;
    const placed = (setup.groups || []).reduce((n, g) => n + (g.slots || []).length, 0);
    return {
        status: setup.status === "approved" ? "approved" : "draft",
        changedSinceApproval: !!setup.changedSinceApproval,
        version: setup.version || 0,
        placed,
        size: Number(event.size) || 0,
        bench: (setup.bench || []).length,
        ok: !!(setup.checks && setup.checks.ok),
        approvedAt: setup.approvedAt || (setup.approved && setup.approved.approvedAt) || 0,
    };
}

// ---- the editor's view ------------------------------------------------------

function specTable(versionId) {
    const rules = rulesFor(versionId || DEFAULT_VERSION) || rulesFor(DEFAULT_VERSION);
    const specs = new Map();
    const classes = new Map();
    for (const c of rules.classes) {
        classes.set(c.id, c);
        for (const s of c.specs) specs.set(s.key, s);
    }
    return { specs, classes, partyBuffs: rules.partyBuffs || [], raidBuffs: rules.raidBuffs || [] };
}

/**
 * The party buffs one spec would bring into a group with these members (spec
 * keys, the spec's own place excluded): each buff with how many of them it
 * helps. A buff everybody wants is left out (it decides nothing), and a slotted
 * one (a totem element, a shout) counts once per provider — the most useful.
 */
function partyBenefits(table, specKey, memberSpecs) {
    const bySlot = new Map();
    const out = [];
    for (const b of table.partyBuffs) {
        if (!b.providers.includes(specKey) || b.beneficiaries.length >= table.specs.size) continue;
        const count = memberSpecs.filter((s) => b.beneficiaries.includes(s)).length;
        if (!count) continue;
        const hit = { key: b.key, label: b.label, icon: b.icon, count };
        if (!b.slot) {
            out.push(hit);
        } else if (!bySlot.has(b.slot) || bySlot.get(b.slot).count < count) {
            bySlot.set(b.slot, hit);
        }
    }
    return [...out, ...bySlot.values()].sort((a, b) => b.count - a.count);
}

/**
 * What a raider brings to the group they stand in (party buffs, with how many
 * profit) and to the raid (raid buffs) — the tooltip draws these as icons — and
 * `fit`: for every *other* group how many would profit if they stood there, so
 * the editor can glow the sensible place while somebody is dragged.
 */
function withBuffInfo(person, group, groups, table) {
    const spec = person.spec;
    const brings = [];
    if (group) {
        const mates = group.slots.filter((s) => s.userId !== person.userId).map((s) => s.spec);
        for (const b of partyBenefits(table, spec, mates)) brings.push({ ...b, scope: "party" });
    }
    for (const b of table.raidBuffs) {
        if (b.providers.includes(spec)) brings.push({ key: b.key, label: b.label, icon: b.icon, scope: "raid", count: 0 });
    }
    const fit = {};
    for (const g of groups) {
        if (group && g.index === group.index) continue;
        const total = partyBenefits(table, spec, g.slots.map((s) => s.spec)).reduce((n, b) => n + b.count, 0);
        if (total) fit[g.index] = total;
    }
    return { ...person, brings, fit };
}

/** The editor's lineup with `brings` and `fit` on every raider (draft only — the approved copy stays plain). */
function withBuffInfoAll(lineup, table) {
    if (!lineup) return lineup;
    return {
        ...lineup,
        groups: lineup.groups.map((g) => ({ ...g, slots: g.slots.map((s) => withBuffInfo(s, g, lineup.groups, table)) })),
        bench: lineup.bench.map((b) => withBuffInfo(b, null, lineup.groups, table)),
    };
}

/** A slot/bench entry with what the page draws: class colour, spec label and icon, Discord name. */
function decoratePerson(x, table, names) {
    const spec = table.specs.get(x.spec) || null;
    const cls = table.classes.get(x.classId || (spec && spec.classId)) || null;
    return {
        ...x,
        name: names[String(x.userId)] || "",
        classColor: (cls && cls.color) || "",
        classLabel: (cls && cls.label) || "",
        specLabel: (spec && spec.label) || "",
        specIcon: (spec && spec.icon) || (cls && cls.icon) || "",
        // the specs of the raider's class, so the panel can offer "im Setup als Tank / Heiler / …" (a paladin who also plays protection)
        classSpecs: ((cls && cls.specs) || []).map((x) => ({ key: x.key, label: x.label, icon: x.icon || "", role: x.role })),
    };
}

/**
 * A stored setup with everything the editor reads, whatever was stored: a setup
 * written by hand, by an older version or by a script may lack checks, options,
 * weights, warnings or score. Missing parts get neutral defaults (checks say "not
 * ok", nothing is invented) so the page never meets an undefined.
 */
function withSetupDefaults(setup, size) {
    if (!setup) return setup;
    const groups = Array.isArray(setup.groups) ? setup.groups : [];
    const bench = Array.isArray(setup.bench) ? setup.bench : [];
    const c = setup.checks && typeof setup.checks === "object" ? setup.checks : {};
    const b = c.buffs && typeof c.buffs === "object" ? c.buffs : {};
    const placed = groups.reduce((n, g) => n + ((g && g.slots) || []).length, 0);
    const checks = {
        ...c,
        ok: !!c.ok,
        size: c.size && typeof c.size === "object" ? c.size : { count: placed, size: Number(size) || 0, ok: false },
        roles: c.roles && typeof c.roles === "object" ? c.roles : {},
        buffs: { ...b, ok: !!b.ok, required: Array.isArray(b.required) ? b.required : [], raid: Array.isArray(b.raid) ? b.raid : [], party: Array.isArray(b.party) ? b.party : [] },
        wishes: c.wishes && typeof c.wishes === "object" ? c.wishes : { met: 0, total: 0 },
    };
    return {
        ...setup,
        status: setup.status === "approved" ? "approved" : "draft",
        version: Number(setup.version) || 0,
        origin: setup.origin || "manual",
        groups: groups.map((g) => ({ ...g, slots: Array.isArray(g && g.slots) ? g.slots : [] })),
        bench,
        checks,
        weights: setup.weights && typeof setup.weights === "object" ? setup.weights : {},
        score: setup.score && typeof setup.score === "object" ? setup.score : { total: 0 },
        warnings: Array.isArray(setup.warnings) ? setup.warnings : [],
        historySource: setup.historySource || "",
        options: setup.options && typeof setup.options === "object" ? setup.options : { weights: {}, fairness: null, wishes: null },
        explanation: setup.explanation || null,
    };
}

function decorateLineup(setup, table, names) {
    if (!setup) return null;
    return {
        ...setup,
        // every slot with a place of its own (a proposal or an old draft has none: 1, 2, 3 …)
        groups: (setup.groups || []).map((g) => ({ ...g, slots: placeSlots((g.slots || []).map((s) => decoratePerson(s, table, names))) })),
        bench: (setup.bench || []).map((b) => decoratePerson(b, table, names)),
    };
}

/**
 * Signups nobody placed yet — someone who signed up after the last proposal
 * or save, so the orga's draft never falls behind (#354): they land on the
 * bench, so they can be dragged into a group by hand like anyone else there.
 * Represented by their first signed character (priority 0) — the full
 * off-spec/`canAlso` option logic of setupInput.js is out of scope for a
 * manually-added bench entry. Only the draft gains them; `approved` is never
 * touched (docs/setup.md, "Change after approval").
 */
function addUnplacedSignups(decorated, signups, table, names) {
    if (!decorated) return decorated;
    const placed = new Set();
    for (const g of decorated.groups || []) for (const s of g.slots || []) placed.add(String(s.userId));
    for (const b of decorated.bench || []) placed.add(String(b.userId));
    const extra = (signups || [])
        .filter((s) => s && s.userId && s.status !== "absence" && !placed.has(String(s.userId)))
        .map((s) => decoratePerson({
            userId: String(s.userId), character: s.character || "", spec: s.spec || "",
            // the signup's own role, else the spec's (a fixture/import may skip it — the spec always knows)
            role: s.role || (table.specs.get(s.spec) || {}).role || "",
            status: s.status || "", locked: false,
        }, table, names));
    return extra.length ? { ...decorated, bench: [...decorated.bench, ...extra] } : decorated;
}

/**
 * GET /api/raids/setup's answer. The orga (`canWrite`) gets the draft with
 * reasons, checks and options; anyone else only the approved lineup — the
 * draft is not in the payload at all.
 */
function editorView(event, { canWrite = false, names = {}, signups = [], hasApiKey = false, job = null, avoidPairs = 0, attendance = null } = {}) {
    const table = specTable(event.versionId);
    const approved = decorateLineup(approvedSetupOf(event), table, names);
    const head = {
        eventId: event.id,
        event: {
            id: event.id, title: event.title, startTime: event.startTime, size: event.size,
            composition: event.composition, versionId: event.versionId, fairness: event.fairness, wishes: event.wishes,
        },
        canWrite,
        approved,
    };
    if (!canWrite) return head;
    const setup = event.setup;
    const groupCount = Math.max(1, Math.ceil((Number(event.size) || 0) / 5));
    return {
        ...head,
        setup: setup ? withBuffInfoAll(addUnplacedSignups(decorateLineup(withSetupDefaults(setup, event.size), table, names), signups, table, names), table) : null,
        // per raider: attendance and how sure the character link is — only on the page load, the client keeps it across moves
        ...(attendance ? { attendance } : {}),
        groupCount,
        signupCount: signups.filter((s) => s.status !== "absence").length,
        absent: signups.filter((s) => s.status === "absence").length,
        avoidPairs,
        pingText: pingTextOf(event),
        // raiders marked as an extra tank / healer, by user id
        extraRoles: event.extraRoles || {},
        // what the raid still needs and the message that looks for it (raidSearch.js)
        search: setup ? suggestSearch(event) : null,
        defaults: { weights: DEFAULT_WEIGHTS, maxWeight: MAX_WEIGHT },
        hasApiKey,
        explainJob: job,
    };
}

module.exports = {
    proposeEventSetup, saveEventSetup, approveEventSetup, storeExplanation, approvedPlacementFor, raidHelperSlots, setupSummary, editorView,
    avoidPairCount,
    // only for the tests (#424): not part of the module's API
    _internal: {
        withSetupDefaults, addUnplacedSignups,
    },
};

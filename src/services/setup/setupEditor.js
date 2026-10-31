// The setup of an own event (#263): proposal, manual changes, approval — and
// what everyone who is *not* the orga may see of it.
//
// ⚠️ The setup is always only a proposal until a human with `raids` write
// approves it. Raiders never see a draft: every reader outside the editor
// (signup page, event message, bot lookups, sheet fill) goes through
// setupCore.approvedSetupOf() / approvedPlacementFor() / raidHelperSlots(),
// which only ever read the frozen `approved` snapshot.
//
// Once the approved setup is posted in Discord, the orga works on it live: a
// change is approved by whoever made it and the message follows at once
// (`postedLive`, `storeSetup`). Before the first post a change stays a draft.
//
// Stored on the event (eventStore.setEventSetup) as one object:
//   status              "draft" | "approved"
//   version             bumps on every proposal and every change of the lineup
//   groups, bench, pool, checks, weights, score, warnings, historySource
//                       bench = only who the orga put there, pool = everybody else
//                       signed up and not placed ("Angemeldet", #517)
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
//   leaderUserId        the orga's choice of the raid's leader (#1036, "Als Leader setzen"): kept
//                       placed through every proposal (fixed for the run, without a lock afterwards);
//                       gone once they are not placed any more or the orga lifts it (""). The
//                       proposal marks the leader's slot `leader: true`; storing an approved setup
//                       writes that raider to `event.leaderId` only for the orga's choice or when the
//                       event's raid lead is missing or not in the raid (leaderIdFor).
const eventStore = require("../../stores/events/eventStore");
const { collectSetupInput, proposeSetup } = require("./setupInput");
const { specNameFor } = require("../events/eventSources");
const { evaluateSetup } = require("../../utils/setup/proposal");
const { validatePlacement, placeSlots } = require("../../utils/setup/manual");
const { DEFAULT_WEIGHTS, MAX_WEIGHT } = require("../../utils/setup/score");
const { rulesForEvent } = require("../versions/mainVersion");
const { signupCharacters, characterStatus } = require("../../utils/setup/model");
const { str } = require("../../utils/text");
const { approvedSetupOf, pingTextOf, benchAndPool, confirmationsFor, setupSummary } = require("./setupCore");
const { suggestSearch } = require("./raidSearch");
const { eventLang } = require("../discord/botLanguage");
const signupStore = require("../../stores/events/signupStore");
const { inRaidGroup, signupEventIdOf } = require("../../utils/raidGroup");
const { groupEvents, placedElsewhere, groupSummary, suggestedRaidTotal } = require("../events/raidGroup");


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
    // #517: the bench is an explicit, posted list — moving somebody onto it or off it is a change
    // with the character that waits there (#293): the orga may switch it, and a posted bench names it
    const bench = benchAndPool(setup).bench.map((b) => `${String(b.userId)}/${String(b.character || "").toLowerCase()}`).sort();
    const lineup = bench.length ? `${groups.join("|")}|bench:${bench.join(",")}` : groups.join("|");
    // #1036: raiders see who leads (crown, DM) and the approval sets event.leaderId - a new leader is a change
    const leader = leaderIdOf(setup);
    return leader ? `${lineup}|leader:${leader}` : lineup;
}

/** The user id of the slot marked as the raid's leader (#1036), "" without one. */
function leaderIdOf(setup) {
    for (const g of (setup && setup.groups) || []) {
        const slot = (g.slots || []).find((s) => s && s.leader);
        if (slot) return str(slot.userId);
    }
    return "";
}

/**
 * The raid lead to write to `event.leaderId` with an approved setup (#1036), "" = leave it as
 * it is: the orga's explicit choice always; the proposal's leader only when the event has no
 * raid lead or the entered one does not stand in the raid. A raid lead set by hand in the
 * event edit is never replaced by just any flag holder; a setup without a leader changes nothing.
 */
function leaderIdFor(event, setup) {
    const leader = leaderIdOf(setup);
    if (!leader) return "";
    if (setup.leaderUserId && str(setup.leaderUserId) === leader) return leader;
    const entered = str(event && event.leaderId);
    return entered && leaderChoiceIn(setup.groups, entered) ? "" : leader;
}

/** The orga's leader choice while that raider stands in one of `groups`, else "". */
function leaderChoiceIn(groups, userId) {
    const id = str(userId);
    return id && (groups || []).some((g) => (g.slots || []).some((s) => str(s.userId) === id)) ? id : "";
}

/** The frozen, raider-facing copy of a lineup: names, specs, groups — no reasons, no wishes. */
function snapshotOf(setup, { at, by }) {
    const person = (x) => ({ userId: String(x.userId), character: x.character || "", classId: x.classId || "", spec: x.spec || "", role: x.role || "", ...(x.pos ? { pos: x.pos } : {}), ...(x.leader ? { leader: true } : {}) });
    return {
        version: setup.version,
        approvedAt: at,
        approvedBy: by,
        groups: (setup.groups || []).map((g) => ({ index: g.index, slots: (g.slots || []).map(person) })),
        // only the orga's explicit bench (#517) — the pool ("Angemeldet") is never part of what raiders see
        bench: benchAndPool(setup).bench.map(person),
    };
}

/** The proposal output reduced to what is stored for one event. */
function stored(result) {
    return {
        proposalVersion: result.version,
        versionId: result.versionId,
        groups: result.groups,
        bench: result.bench,
        pool: result.pool || [],
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
    // the orga's leader (#1036): a manual save hands its choice in, a proposal keeps the stored one
    const leader = leaderChoiceIn(result.groups, result.leaderUserId !== undefined ? result.leaderUserId : prev && prev.leaderUserId);
    if (leader) base.leaderUserId = leader;
    else delete base.leaderUserId;
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

/** A setup as approved by `userId` at `now`: the frozen snapshot for raiders included. */
function approvedVersionOf(setup, { userId, now }) {
    return {
        ...setup,
        status: "approved",
        changedSinceApproval: false,
        approvedAt: now,
        approvedBy: str(userId),
        approvedVersion: setup.version,
        approved: snapshotOf(setup, { at: now, by: str(userId) }),
    };
}

/**
 * Whether the approved setup is out in Discord (its message posted, the event not
 * cancelled). Then a change in the editor goes live at once: the new lineup is
 * approved by whoever made it and the message follows — the orga changes a
 * posted setup, it does not draft a second one beside it.
 */
function postedLive(event) {
    return !!(event && event.status !== "cancelled" && event.setupPost && event.setupPost.messageId && approvedSetupOf(event));
}

/**
 * Store the next setup — approved at once while the setup is posted
 * (`postedLive`), else as it comes. `live: true` tells the caller to bring the
 * message (and the ping) up to date (setupMessage.refreshLiveSetup). The
 * confirmations are not touched: they stay through every change
 * (setupCore.confirmationsFor).
 */
function storeSetup(event, setup, { userId, now }) {
    // an empty lineup is never approved, live or not (approveEventSetup's "no_setup")
    const live = setup.status !== "approved" && postedLive(event) && (setup.groups || []).some((g) => (g.slots || []).length);
    const saved = eventStore.setEventSetup(event.id, live ? approvedVersionOf(setup, { userId, now }) : setup, live ? { leaderId: leaderIdFor(event, setup) } : {});
    return live ? { setup: saved.setup, event: saved, live: true } : { setup: saved.setup, event: saved };
}

function ownEvent(eventId) {
    const event = eventStore.getEvent(eventId);
    if (!event) return { failed: fail(eventStore.isOwnEventId(eventId) ? "not_found" : "raidhelper", eventStore.isOwnEventId(eventId) ? "Event nicht gefunden." : "Das Setup dieses Events liegt bei Raid-Helper.") };
    return { event };
}

/**
 * "Freie Plätze füllen": everybody the orga placed stood fixed for the run, but
 * only the ones they locked themselves keep the lock (and its reason) — and each
 * keeps the place 1–5 they stood on.
 */
function keptAsPlaced(result, prev) {
    const lockedBefore = new Set((prev.groups || []).flatMap((g) => (g.slots || []).filter((s) => s.locked).map((s) => String(s.userId))));
    // nor the orga's pick of a further character (reasons.characterChoiceReason) — they only stood fixed for the run
    const byOrga = (r) => r === "Von der Orga fixiert" || r.endsWith("(von der Orga gewählt)");
    const unlock = (s) => (lockedBefore.has(String(s.userId)) ? s : { ...s, locked: false, reasons: (s.reasons || []).filter((r) => !byOrga(r)) });
    const groups = (result.groups || []).map((g) => ({ ...g, slots: (g.slots || []).map(unlock) }));
    return { ...result, groups: inPlacedOrder(groups, prev.groups) };
}

/**
 * The orga's leader choice (#1036) stood fixed for the run only: unless the orga locked that
 * raider themselves, the slot carries no lock and no "Von der Orga fixiert" afterwards - a
 * later leader change leaves the former leader a normal, movable raider.
 */
function leaderUnlocked(result, prev) {
    const chosen = str(prev && prev.leaderUserId);
    if (!chosen) return result;
    const lockedBefore = (prev.groups || []).some((g) => (g.slots || []).some((s) => str(s.userId) === chosen && s.locked));
    if (lockedBefore) return result;
    const unlock = (s) => (str(s.userId) === chosen ? { ...s, locked: false, reasons: (s.reasons || []).filter((r) => r !== "Von der Orga fixiert") } : s);
    return { ...result, groups: (result.groups || []).map((g) => ({ ...g, slots: (g.slots || []).map(unlock) })) };
}

/**
 * A fresh proposal for the event, keeping the places locked in its current
 * draft (setupInput.fixedFromSetup). Stored as a draft.
 * `body.keep === "placed"` ("Freie Plätze füllen"): everybody already in a group
 * stays where they are, only the free places and the bench are filled.
 * `shadowbannedOf` (vermerkeShort.shadowbannedAmong, handed in by the orga's route): whom the proposal
 * keeps in the pool for a shadowban (#981) - this module stays free of the Vermerke.
 * @returns {{ setup?: object, event?: object, error?: string, code?: string }}
 */
function proposeEventSetup(eventId, body = {}, { userId = "", now = Date.now(), shadowbannedOf = null } = {}) {
    const { event, failed } = ownEvent(eventId);
    if (failed) return failed;
    if (inRaidGroup(event) && groupEvents(event).length > 1) return proposeGroupSetup(event, body, { userId, now, shadowbannedOf });
    const options = mergeOptions(body, event.setup && event.setup.options);
    const keepPlaced = body.keep === "placed" && !!event.setup;
    const proposed = proposeSetup([event.id], runOptions(options, { now, keepPlaced, shadowbannedOf }));
    if (!proposed) return fail("not_found", "Event nicht gefunden.");
    const result = keepPlaced ? keptAsPlaced(proposed, event.setup) : leaderUnlocked(proposed, event.setup);
    const setup = nextSetup(event.setup, result, { origin: "proposal", options, userId, now });
    // A proposal that lands on the approved lineup again leaves the approval standing.
    return storeSetup(event, setup, { userId, now });
}

/**
 * A raid group (#811): the proposal ("Neu vorschlagen", "Freie Plätze füllen")
 * runs over every raid of the group at once — proposeSetup() with all their ids,
 * the raids run in parallel and share the raiders of the first raid's signup, so
 * nobody gets two seats. Each raid stores its own part (groups, checks); the
 * explicit bench stays with the raid whose setup had it, the pool is shared.
 * Answers the asked raid's result plus `others` (the other raids' results, each
 * maybe `live`).
 */
function proposeGroupSetup(event, body, { userId, now, shadowbannedOf }) {
    const raids = groupEvents(event);
    const options = mergeOptions(body, event.setup && event.setup.options);
    const keepPlaced = body.keep === "placed";
    const proposed = proposeSetup(raids.map((e) => e.id), runOptions(options, { now, keepPlaced, shadowbannedOf }));
    if (!proposed) return fail("not_found", "Event nicht gefunden.");
    const benchOwner = new Map();
    for (const e of raids) for (const b of benchAndPool(e.setup || {}).bench) benchOwner.set(String(b.userId), e.id);
    const results = raids.map((e) => {
        const part = (proposed.events || []).find((x) => x.eventId === e.id) || { groups: [], checks: proposed.checks };
        let result = {
            ...proposed,
            groups: part.groups,
            checks: {
                ...part.checks,
                avoid: proposed.checks && proposed.checks.avoid,
                // #1037: the loot overlaps span the whole group - every raid shows the same list
                ...(proposed.checks && proposed.checks.loot ? { loot: proposed.checks.loot } : {}),
            },
            bench: (proposed.bench || []).filter((b) => benchOwner.get(String(b.userId)) === e.id),
            pool: proposed.pool || [],
        };
        if (keepPlaced && e.setup) result = keptAsPlaced(result, e.setup);
        else result = leaderUnlocked(result, e.setup);
        const own = e.id === event.id ? options : mergeOptions(body, e.setup && e.setup.options);
        const setup = nextSetup(e.setup, result, { origin: "proposal", options: own, userId, now });
        return { id: e.id, stored: storeSetup(e, setup, { userId, now }) };
    });
    const mine = results.find((r) => r.id === event.id).stored;
    return { ...mine, others: results.filter((r) => r.id !== event.id).map((r) => r.stored) };
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
 * The sentence why a lineup may not be saved in a raid of a group (#811):
 * somebody in it already stands in another raid of the group (group or bench).
 * "" when nobody does — outside a group always.
 */
function takenElsewhere(event, placement) {
    if (!inRaidGroup(event)) return "";
    const elsewhere = placedElsewhere(event);
    if (!elsewhere.size) return "";
    const people = [
        ...(placement.groups || []).flatMap((g) => g.slots || []),
        ...(placement.bench || []),
    ];
    const hit = people.find((p) => elsewhere.has(String(p.userId)));
    if (!hit) return "";
    const where = elsewhere.get(String(hit.userId));
    return `${hit.character || hit.userId} steht schon in ${where.title} – jede Person hat in der Raid-Gruppe nur einen Platz.`;
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
    // `previous`: a character the stored setup already shows passes even when the signup changed since (manual.js)
    const checked = validatePlacement(body, { event, signups: input.signups, previous: prev });
    if (checked.error) return fail("invalid", checked.error);
    // a raid group (#811): one seat per person across all its raids
    const taken = takenElsewhere(event, checked.value);
    if (taken) return fail("taken", taken);
    const options = mergeOptions(body, prev && prev.options);
    // "Als Leader setzen" (#1036): `leaderUserId` in the body sets ("" clears) the orga's choice,
    // without it the stored one stays - each only while that raider is placed in this raid and
    // only under a leader rule (`leaders` in the input): without one there is no leader at all
    const rule = !!input.events[0] && Array.isArray(input.events[0].leaders);
    const leaderUserId = !rule ? "" : leaderChoiceIn(checked.value.groups, body.leaderUserId !== undefined ? body.leaderUserId : prev && prev.leaderUserId);
    if (input.events[0]) input.events[0].leaderUserId = leaderUserId;
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
    // #1037: loot spans the raid group - valued as a whole, this raid takes the group's loot;
    // without a group value (data gone after 30 days, or the others no longer value) no raid of
    // the group keeps a loot check or loot reason: an old one would describe another setup
    const others = groupOthers(event);
    const group = others.length ? groupLootOf(event, checked.value, others, { options, now, leaderUserId }) : null;
    const own = others.length ? withGroupLoot(result, group && group.events.find((x) => x.eventId === event.id), group && group.checks.loot) : result;
    const groups = inPlacedOrder(own.groups, checked.value.groups);
    const setup = nextSetup(prev, { ...own, groups, historySource: input.historySource, leaderUserId }, { origin: "manual", options, userId, now });
    const saved = storeSetup(event, setup, { userId, now });
    if (others.length && !saved.error) refreshGroupLoot(group || { others, events: [], checks: {} });
    return saved;
}

/** The other raids of this raid's group (#811), empty outside one. */
function groupOthers(event) {
    return inRaidGroup(event) ? groupEvents(event).filter((e) => e.id !== event.id) : [];
}

/**
 * The raid group valued as a whole after a manual change of one raid (#1037): this raid as the
 * orga placed it, the others as they stand. Null without loot data or when the others no longer
 * value (their own save tells why) - the group then shows no loot at all.
 */
function groupLootOf(event, placement, others, { options, now, leaderUserId }) {
    const input = collectSetupInput([event.id, ...others.map((e) => e.id)], { now });
    if (!input || !input.loot) return null;
    if (input.events[0]) input.events[0].leaderUserId = leaderUserId;
    try {
        const result = evaluateSetup(input, {
            groups: placement.groups,
            bench: placement.bench,
            others: others.map((e) => ({ eventId: e.id, groups: (e.setup && e.setup.groups) || [] })),
        }, runOptions(options));
        if (!result.checks || !result.checks.loot || !Array.isArray(result.events)) return null;
        return { checks: result.checks, events: result.events, others };
    } catch {
        return null;
    }
}

/** A raider's loot reason swapped for the group's: the old text out of `reasons`, the new one in. */
function withSlotLoot(slot, fresh) {
    const old = slot.lootReason && slot.lootReason.text;
    const reasons = (slot.reasons || []).filter((r) => r !== old);
    const next = fresh && fresh.lootReason;
    const rest = { ...slot };
    delete rest.lootReason;
    if (!next) return { ...rest, reasons };
    return { ...rest, reasons: reasons.includes(next.text) ? reasons : [...reasons, next.text], lootReason: next };
}

/**
 * One raid's valued result with the group's loot: `checks.loot` and every slot's loot reason.
 * Without `loot` (no group value) both go: no loot check, no loot reason.
 */
function withGroupLoot(result, part, loot) {
    const fresh = new Map();
    for (const g of (part && part.groups) || []) for (const s of g.slots || []) fresh.set(String(s.userId), s);
    const checks = { ...result.checks };
    if (loot) checks.loot = loot;
    else delete checks.loot;
    return {
        ...result,
        groups: (result.groups || []).map((g) => ({ ...g, slots: (g.slots || []).map((s) => withSlotLoot(s, fresh.get(String(s.userId)))) })),
        checks,
    };
}

/**
 * The other raids of the group after a manual change (#1037): only their loot check and loot
 * reasons follow - no new version, no status change, no repost, the leader untouched. Without
 * a group value (`events` empty, no `checks.loot`) both are cleared.
 */
function refreshGroupLoot(group) {
    group.others.forEach((e) => {
        const fresh = eventStore.getEvent(e.id);
        if (!fresh || !fresh.setup) return;
        const part = group.events.find((x) => x.eventId === e.id);
        const next = withGroupLoot(fresh.setup, part, group.checks.loot);
        eventStore.setEventSetup(e.id, { ...fresh.setup, groups: next.groups, checks: next.checks });
    });
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
    // the raid's leader (#1036) follows the approved setup
    const saved = eventStore.setEventSetup(event.id, approvedVersionOf(setup, { userId, now }), { leaderId: leaderIdFor(event, setup) });
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

// ---- the editor's view ------------------------------------------------------

function specTable(versionId) {
    const rules = rulesForEvent({ versionId });
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
        // A shared slot (Forever's air totems do not stack, even across shamans):
        // once a mate fills it, a second provider adds nothing.
        if (b.sharedSlot && memberSpecs.some((m) => table.partyBuffs.some((o) => o.slot === b.slot && o.providers.includes(m)))) continue;
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
        pool: (lineup.pool || []).map((b) => withBuffInfo(b, null, lineup.groups, table)),
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
    // an old setup (no pool) is read the #517 way: its unlocked bench is the pool
    const { bench, pool } = benchAndPool(setup);
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
        pool,
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
        pool: (setup.pool || []).map((b) => decoratePerson(b, table, names)),
    };
}

/**
 * Signups nobody placed yet — someone who signed up after the last proposal
 * or save, so the orga's draft never falls behind (#354): they land in the
 * pool ("Angemeldet", #517), so they can be dragged into a group or onto the
 * bench by hand like anyone else there.
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
    for (const b of decorated.pool || []) placed.add(String(b.userId));
    const extra = (signups || [])
        .filter((s) => s && s.userId && s.status !== "absence" && !placed.has(String(s.userId)))
        .map((s) => decoratePerson({
            userId: String(s.userId), character: s.character || "", spec: s.spec || "",
            // the signup's own role, else the spec's (a fixture/import may skip it — the spec always knows)
            role: s.role || (table.specs.get(s.spec) || {}).role || "",
            status: s.status || "", locked: false,
        }, table, names));
    return extra.length ? { ...decorated, pool: [...(decorated.pool || []), ...extra] } : decorated;
}

/** The lineup without the pool entries another raid of the group already holds (#811). */
function withoutElsewhere(lineup, elsewhere) {
    if (!lineup || !elsewhere || !elsewhere.size) return lineup;
    return { ...lineup, pool: (lineup.pool || []).filter((p) => !elsewhere.has(String(p.userId))) };
}

/**
 * Every character a raider signed up with (#293), decorated like a slot: the
 * order is theirs (`priority` 0 = the choice, then "kann auch mit"), each with
 * its own status (#320). Only for somebody with more than one — the editor
 * lists them under the raider in "Angemeldet" and offers "Charakter wechseln".
 */
function signedCharacters(signup, table) {
    if (!signup || signup.status === "absence") return [];
    const list = signupCharacters(signup)
        .map((c, priority) => {
            const spec = table.specs.get(str(c.spec)) || null;
            const cls = table.classes.get(spec && spec.classId) || null;
            return {
                character: str(c.character),
                spec: str(c.spec),
                role: (spec && spec.role) || "",
                status: characterStatus(c, signup.status) || "",
                priority,
                classId: (cls && cls.id) || "",
                classColor: (cls && cls.color) || "",
                classLabel: (cls && cls.label) || "",
                specLabel: (spec && spec.label) || "",
                specIcon: (spec && spec.icon) || (cls && cls.icon) || "",
            };
        })
        .filter((c) => c.character && c.spec);
    return list.length > 1 ? list : [];
}

/** The editor's lineup with `characters` on everybody who signed up with several. */
function withCharacters(lineup, signups, table) {
    if (!lineup) return lineup;
    const byUser = new Map((signups || []).filter((s) => s && s.userId).map((s) => [String(s.userId), s]));
    const add = (p) => {
        const characters = signedCharacters(byUser.get(String(p.userId)), table);
        return characters.length ? { ...p, characters } : p;
    };
    return {
        ...lineup,
        groups: lineup.groups.map((g) => ({ ...g, slots: g.slots.map(add) })),
        bench: lineup.bench.map(add),
        pool: (lineup.pool || []).map(add),
    };
}

/**
 * The editor's start before anything is stored: no proposal needed — every
 * group empty, everybody who signed up in the pool ("Angemeldet"), valued like a
 * hand-made lineup so the counts read "0 von 3". Version 0 and `blank: true`:
 * nothing is written until the first move (saveEventSetup takes it as the first
 * version). Should the valuation fail, the groups stay empty all the same and
 * the pool is filled from the signups (addUnplacedSignups).
 */
function emptyValued(event, now) {
    try {
        const input = collectSetupInput([event.id], { now });
        if (!input) return null;
        return { ...evaluateSetup(input, { groups: [], bench: [] }, runOptions(mergeOptions({}, {}))), historySource: input.historySource };
    } catch {
        return null;
    }
}

function blankSetup(event, { now = Date.now() } = {}) {
    const result = emptyValued(event, now);
    return {
        ...(result ? stored(result) : { groups: [], bench: [], pool: [] }),
        status: "draft",
        version: 0,
        origin: "manual",
        blank: true,
        options: { weights: {}, fairness: null, wishes: null },
    };
}

/**
 * GET /api/raids/setup's answer. The orga (`canWrite`) gets the draft with
 * reasons, checks and options; anyone else only the approved lineup — the
 * draft is not in the payload at all.
 */
function editorView(event, { canWrite = false, names = {}, signups = [], hasApiKey = false, job = null, avoidPairs = 0, attendance = null, blank = false } = {}) {
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
        // the raids of the event's group (#811): the editor's tabs "Raid 1 | Raid 2", null outside a group
        raidGroup: groupSummary(event),
    };
    if (!canWrite) return head;
    // nothing stored yet: the empty start the orga drags into (no proposal needed)
    const setup = event.setup || (blank ? blankSetup(event) : null);
    const groupCount = Math.max(1, Math.ceil((Number(event.size) || 0) / 5));
    // a raid group (#811): the pool "Angemeldet" is shared — whoever stands in another raid of the group is not in it
    const elsewhere = placedElsewhere(event);
    const lineup = setup ? withoutElsewhere(addUnplacedSignups(decorateLineup(withSetupDefaults(setup, event.size), table, names), signups, table, names), elsewhere) : null;
    const signupCount = signups.filter((s) => s.status !== "absence").length;
    return {
        ...head,
        setup: lineup ? withCharacters(withBuffInfoAll(lineup, table), signups, table) : null,
        // how many signed-up raiders the other raids of the group hold (they are left out of "Angemeldet")
        placedElsewhere: elsewhere.size,
        // per raider: attendance and how sure the character link is — only on the page load, the client keeps it across moves
        ...(attendance ? { attendance } : {}),
        groupCount,
        signupCount,
        // "Auf 5 Raids aufteilen" (#1035): raids in total the signups fill, by the raid's size
        suggestedTotal: suggestedRaidTotal({ active: signupCount, size: event.size }),
        absent: signups.filter((s) => s.status === "absence").length,
        avoidPairs,
        pingText: pingTextOf(event, eventLang(event)),
        // Confirm/Cancel by user id — the raiders' clicks and the orga's own marks (setupConfirm.js)
        confirmations: confirmationsFor(event, approvedSetupOf(event)),
        // raiders marked as an extra tank / healer, by user id
        extraRoles: event.extraRoles || {},
        // what the raid still needs and the message that looks for it (raidSearch.js)
        search: setup ? suggestSearch({ ...event, setup }) : null,
        defaults: { weights: DEFAULT_WEIGHTS, maxWeight: MAX_WEIGHT },
        hasApiKey,
        explainJob: job,
    };
}

// ---- a raid group: moving between its raids ---------------------------------

/** A stored setup as the placement saveEventSetup() takes (who stands where, locks, places). */
function placementOf(setup) {
    if (!setup) return { groups: [], bench: [] };
    return {
        groups: (setup.groups || []).map((g) => ({
            index: g.index,
            slots: (g.slots || []).map((s) => ({ userId: str(s.userId), character: s.character || "", spec: s.spec || "", role: s.role || "", locked: s.locked === true, ...(s.pos ? { pos: s.pos } : {}) })),
        })),
        bench: benchAndPool(setup).bench.map((b) => ({ userId: str(b.userId), ...(b.character ? { character: b.character } : {}), locked: b.locked === true })),
    };
}

/** Where a person stands in a placement: their slot (with the group) or bench entry, null when in neither. */
function findIn(placement, userId) {
    for (const g of placement.groups) {
        const slot = g.slots.find((s) => s.userId === userId);
        if (slot) return { slot, group: g.index };
    }
    const bench = placement.bench.find((b) => b.userId === userId);
    return bench ? { bench } : null;
}

/** The first group of a raid with a free place, 0 when the raid is full. */
function freeGroup(placement, size) {
    const groupCount = Math.max(1, Math.ceil((Number(size) || 0) / 5));
    const placed = placement.groups.reduce((n, g) => n + g.slots.length, 0);
    if (placed >= (Number(size) || 0)) return 0;
    for (let index = 1; index <= groupCount; index++) {
        const g = placement.groups.find((x) => Number(x.index) === index);
        if (!g || g.slots.length < 5) return index;
    }
    return 0;
}

/**
 * What a person plays when they come out of "Angemeldet" into a raid: the named
 * character (#293), else their first — spec and role from the signup.
 */
function playedFromSignup(signup, character, table) {
    const list = signupCharacters(signup).filter((c) => c && c.character && c.spec);
    const want = str(character).toLowerCase();
    const pick = (want && list.find((c) => str(c.character).toLowerCase() === want)) || list[0];
    if (!pick) return null;
    const spec = table.specs.get(str(pick.spec));
    return { character: str(pick.character), spec: str(pick.spec), role: (spec && spec.role) || "" };
}

/** The target raid of a move inside the event's group, or a failure. */
function moveTarget(event, target) {
    const to = eventStore.getEvent(str(target));
    if (!to || to.id === event.id || !inRaidGroup(event) || signupEventIdOf(to) !== signupEventIdOf(event)) {
        return { failed: fail("invalid", "Das Ziel ist kein anderer Raid dieser Raid-Gruppe.") };
    }
    if (to.status === "cancelled") return { failed: fail("cancelled", `${to.title} ist abgesagt.`) };
    return { to };
}

/**
 * What the moved raider plays in the other raid: from a group place as they
 * stand, off the bench as the character waiting there (or the named one), out of
 * the shared pool as the named character or their first. A failure for somebody
 * who is not signed up or already stands in a raid.
 */
function movedPlay(event, to, here, uid, character, table) {
    const signup = () => signupStore.getSignup(signupEventIdOf(event), uid);
    if (here && here.slot) return { played: { character: here.slot.character, spec: here.slot.spec, role: here.slot.role } };
    if (here) return { played: playedFromSignup(signup(), character || here.bench.character, table) };
    const own = signup();
    if (!own || own.status === "absence") return { failed: fail("invalid", "Dieser Raider ist nicht angemeldet.") };
    const elsewhere = placedElsewhere(event).get(uid);
    if (elsewhere) return { failed: fail(elsewhere.eventId === to.id ? "invalid" : "taken", `Steht schon in ${elsewhere.title}.`) };
    return { played: playedFromSignup(own, character, table) };
}

/** A placement with one more raider at the end of group `group`. */
function withAdded(placement, group, slot) {
    const groups = placement.groups.some((g) => Number(g.index) === group)
        ? placement.groups.map((g) => (Number(g.index) === group ? { ...g, slots: [...g.slots, slot] } : g))
        : [...placement.groups, { index: group, slots: [slot] }];
    return { groups, bench: placement.bench };
}

/** A placement without one raider (group place or bench). */
function withoutRaider(placement, uid) {
    return {
        groups: placement.groups.map((g) => ({ ...g, slots: g.slots.filter((s) => s.userId !== uid) })),
        bench: placement.bench.filter((b) => b.userId !== uid),
    };
}

const versionOf = (event) => (event.setup ? event.setup.version : undefined);

/**
 * Move one raider from this raid (a group place, the bench or the shared pool)
 * into another raid of the same group (#811): onto that raid's first free group
 * place, as they stand (character, spec, role) — out of the pool as the named
 * `character` or their first. Both raids are saved through saveEventSetup (this
 * one first, so the one-seat rule never trips over the move itself); a failed
 * second save puts the raider back. Answers this raid's result plus `target`
 * (the other raid's).
 */
function moveToRaid(eventId, { target, userId: raider, character = "" } = {}, { userId = "", now = Date.now() } = {}) {
    const { event, failed } = ownEvent(eventId);
    if (failed) return failed;
    const { to, failed: noTarget } = moveTarget(event, target);
    if (noTarget) return noTarget;
    const uid = str(raider);
    const fromPlacement = placementOf(event.setup);
    const here = findIn(fromPlacement, uid);
    const { played, failed: notMoved } = movedPlay(event, to, here, uid, character, specTable(event.versionId));
    if (notMoved) return notMoved;
    if (!played || !played.spec) return fail("invalid", "Für diesen Raider ist kein Charakter angemeldet.");
    const toPlacement = placementOf(to.setup);
    const group = freeGroup(toPlacement, to.size);
    if (!group) return fail("full", `${to.title} ist voll – erst dort einen Platz freimachen.`);
    const fromResult = here ? saveEventSetup(event.id, { ...withoutRaider(fromPlacement, uid), version: versionOf(event) }, { userId, now }) : null;
    if (fromResult && fromResult.error) return fromResult;
    const toResult = saveEventSetup(to.id, { ...withAdded(toPlacement, group, { userId: uid, ...played, locked: false }), version: versionOf(to) }, { userId, now });
    if (toResult.error) {
        // put the raider back where they stood, best effort
        // with the raid's leader choice (#1036): it was lost when the moved raider was the leader
        if (here) saveEventSetup(event.id, { ...fromPlacement, leaderUserId: str(event.setup && event.setup.leaderUserId) }, { userId, now });
        return toResult;
    }
    const fresh = eventStore.getEvent(event.id) || event;
    const mine = fromResult || { setup: fresh.setup, event: fresh };
    return { ...mine, target: toResult, moved: { userId: uid, character: played.character, to: to.id, title: to.title, group } };
}

module.exports = {
    proposeEventSetup, saveEventSetup, moveToRaid, approveEventSetup, storeExplanation, approvedPlacementFor, raidHelperSlots, setupSummary, editorView,
    avoidPairCount,
    // only for the tests (#424): not part of the module's API
    _internal: {
        leaderIdFor,
        withSetupDefaults, addUnplacedSignups, blankSetup, lineupSignature,
    },
};

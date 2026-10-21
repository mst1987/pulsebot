// The draft of a Kader's composition (docs/kaderplaner.md, "Zusammensetzung",
// "Planspiel"): one shared draft per Kader in which the leads try another spec
// for a player (one of their decision and wishes) or leave a player out for a
// moment, and see roles and buffs change. Nothing of it reaches a state, the
// roster or anything outside the planner until it is taken over: then the
// planned specs become the players' decisions — also for Vorläufige, without a
// state change — and the draft is gone. Pure mutators like kaderModel.js.
//
//   kader.plan = { specs: { [userId]: { className, spec } }, excluded: [userId], by, at, rev? } | null
//
// `specs` holds only what differs from the spec the page counts a player with
// (the client sends `spec: null` to take a change back). The kaderModel
// normalisation drops players who left the composition and specs that are no
// longer one of the player's decision and wishes.
const {
    SETUP_STATES, str, invalid, notFound, conflict, withKader, cleanClassSpec, assertFresh, plannableSpecs,
} = require("./kaderModel");

function emptyPlan() {
    return { specs: {}, excluded: [], by: "", at: "" };
}

/** The player of the composition the change is for. */
function compEntry(kader, userId) {
    const entry = kader.players[str(userId)];
    if (!entry) throw notFound("Dieser Spieler ist nicht in diesem Kader.");
    if (!SETUP_STATES.includes(entry.state)) throw invalid("Dieser Spieler gehört nicht zur Zusammensetzung.");
    return entry;
}

/**
 * Changes the draft for one player (one click on the page, so two people
 * working on the draft at once never overwrite each other's players):
 * `spec` { className, spec } plans a spec (one of the player's decision and
 * wishes), `spec: null` takes the planned one back; `excluded` true/false
 * leaves the player out or takes them in again. Starts the draft when there is
 * none. Unchanged = the planner as it was.
 */
function savePlan(planner, input, ctx) {
    const userId = str(input && input.userId);
    if (!userId) throw invalid("Spieler fehlt.");
    const hasSpec = input.spec !== undefined;
    const hasExcluded = input.excluded !== undefined;
    if (!hasSpec && !hasExcluded) throw invalid("Keine Änderung angegeben.");
    let pick = null;
    if (hasSpec && input.spec !== null) pick = cleanClassSpec(input.spec, ctx);
    return withKader(planner, input.kaderId, (kader) => {
        const entry = compEntry(kader, userId);
        const plan = kader.plan ? { ...kader.plan, specs: { ...kader.plan.specs }, excluded: [...kader.plan.excluded] } : emptyPlan();
        const before = JSON.stringify([plan.specs, plan.excluded]);
        if (hasSpec) {
            if (pick && !plannableSpecs(entry).some((p) => p.className === pick.className && p.spec === pick.spec)) {
                throw invalid("Dieser Spec steht nicht in den Wünschen des Spielers.");
            }
            if (pick) plan.specs[userId] = pick;
            else delete plan.specs[userId];
        }
        if (hasExcluded) {
            const out = input.excluded === true;
            plan.excluded = plan.excluded.filter((id) => id !== userId);
            if (out) plan.excluded.push(userId);
        }
        if (kader.plan && JSON.stringify([plan.specs, plan.excluded]) === before) return;
        kader.plan = { ...plan, by: ctx.actor || "", at: ctx.now };
    });
}

/** Throws away the draft ("Verwerfen"). Without a draft there is nothing to throw away. */
function discardPlan(planner, input) {
    return withKader(planner, input.kaderId, (kader) => {
        if (!kader.plan) throw conflict("Es gibt keinen Entwurf.");
        kader.plan = null;
    });
}

/**
 * Takes the draft over ("Als Entscheidung übernehmen"): every planned spec of a
 * player who is not left out becomes their decision (written into their
 * history), whatever their state — nobody changes state, left-out players
 * keep theirs too. The draft is gone afterwards. `baseRev` = the draft's
 * revision the confirmation was shown for (409 `stale` when it moved on).
 * A draft that changes no decision is refused: there is nothing to take over.
 * Answers `{ planner, applied }`, the number of decisions set.
 */
function applyPlan(planner, input, ctx) {
    return withKader(planner, input.kaderId, (kader) => {
        const plan = kader.plan;
        if (!plan) throw conflict("Es gibt keinen Entwurf.");
        assertFresh(input, plan.rev, "Der Entwurf wurde inzwischen geändert.", { by: plan.by, at: plan.at });
        let applied = 0;
        for (const [userId, pick] of Object.entries(plan.specs)) {
            const entry = kader.players[userId];
            if (!entry || plan.excluded.includes(userId)) continue;
            if (entry.decision && entry.decision.className === pick.className && entry.decision.spec === pick.spec) continue;
            entry.decision = { className: pick.className, spec: pick.spec };
            entry.history.push({ at: ctx.now, by: ctx.actor || "", type: "decision", className: pick.className, spec: pick.spec });
            applied += 1;
        }
        if (!applied) throw conflict("Der Entwurf ändert keine Entscheidung.");
        kader.plan = null;
        return { applied };
    });
}

module.exports = { savePlan, discardPlan, applyPlan };

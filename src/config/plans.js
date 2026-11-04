// The plans a server can be on and the features they unlock (docs/server-plans.md).
// Pure data and rules, like config/permissions.js: who is on which plan lives in
// stores/settings/serverPlanStore.js, the answer for a server in
// services/plans/serverPlan.js.
//
// Today there is one plan and it unlocks everything, so no server loses anything.
// To put a function behind a plan later: name the feature in FEATURES, give it to
// the plans that include it (`free` then lists its features instead of ALL_FEATURES)
// and set `feature` on the route, menu entry or bot command.

/** A plan's `features` when it unlocks every feature there is. */
const ALL_FEATURES = "all";

/**
 * Every feature that can be asked for. The client only learns this list per server
 * (`planFeatures` in GET /api/session), so a feature missing here would hide its menu
 * entry on every plan - test/config/plans.test.js holds routes and menu to this list.
 */
const FEATURES = Object.freeze([]);

const DEFAULT_PLAN = "free";

const PLANS = {
    free: { id: "free", features: ALL_FEATURES },
};

/** Whether a plan includes a feature. */
function planAllows(plan, feature) {
    return plan.features === ALL_FEATURES || plan.features.includes(feature);
}

/** The features a plan unlocks, as a list. */
function planFeatureList(plan) {
    return plan.features === ALL_FEATURES ? [...FEATURES] : [...plan.features];
}

module.exports = { ALL_FEATURES, FEATURES, DEFAULT_PLAN, PLANS, planAllows, planFeatureList };

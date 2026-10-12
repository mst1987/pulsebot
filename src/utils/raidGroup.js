// Raid groups (#811): an overbooked own event can get further raids at the same
// time — "Zul'Aman" and "Zul'Aman 2" — that share ONE signup. The raiders sign
// up at the first raid (the group's primary) only; the orga splits them over the
// raids in one setup editor, and every raid keeps its own setup, approval and
// message.
//
// On the record (eventStore.complete): `raidGroupId` is the primary's own id on
// every raid of the group ("" = no group) and `raidGroupIndex` its place, 1 for
// the primary, 2, 3 … for the further raids ("siblings"). So the primary is the
// event whose id is the group id, and the signups of every raid of the group
// are the primary's.
//
// Pure helpers on an event record (no store): every reader can use them, also
// in a test that mocks the stores.

const str = (v) => (v === undefined || v === null ? "" : String(v).trim());

/** The group id of an event, "" when it is in no group. */
function raidGroupIdOf(event) {
    return str(event && event.raidGroupId);
}

/** Whether the event belongs to a raid group (primary or further raid). */
function inRaidGroup(event) {
    return !!raidGroupIdOf(event);
}

/** Whether the event is a further raid of a group — no signup, no message of its own. */
function isRaidSibling(event) {
    const group = raidGroupIdOf(event);
    return !!group && group !== str(event && event.id);
}

/** Whether the event is the first raid of a group, the one the raiders sign up at. */
function isRaidPrimary(event) {
    const group = raidGroupIdOf(event);
    return !!group && group === str(event && event.id);
}

/**
 * The event whose signups count for this one: the group's primary for a raid of
 * a group, else the event itself.
 */
function signupEventIdOf(event) {
    return raidGroupIdOf(event) || str(event && event.id);
}

/** Its place in the group: 1 for the primary (or no group), 2, 3 … for the further raids. */
function raidIndexOf(event) {
    const n = Number(event && event.raidGroupIndex);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
    return isRaidSibling(event) ? 2 : 1;
}

module.exports = { raidGroupIdOf, inRaidGroup, isRaidSibling, isRaidPrimary, signupEventIdOf, raidIndexOf };

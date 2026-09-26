// Fixture factories for events, signups and series (#433). Each returns a fresh
// object with the fields most suites need; a test notes only what differs:
//
//   const { event, ownEvent, signup } = require("../factories/events");
//   event({ startTime: 1000, signUps: [signup()] });
//
// `event()` is the Raid-Helper-shaped event the listings and matchers read
// (id, title, start, channel); `ownEvent()` is an own event (`eh-` id,
// source "eventhelper") with version, size and composition, three days ahead,
// signup deadline in two. Pass `undefined` for a field a test needs absent.

const sec = (ms) => Math.floor(ms / 1000);
const DAY = 86400;

/** A Raid-Helper-style event: id, title, start time (seconds), channel. */
function event(over = {}) {
    return {
        id: "e1",
        title: "Kara",
        startTime: 2000000000,
        channelId: "c1",
        ...over,
    };
}

/** An own event (source "eventhelper") three days ahead, deadline in two. */
function ownEvent(over = {}) {
    const now = sec(Date.now());
    return {
        id: "eh-kara",
        source: "eventhelper",
        title: "Karazhan",
        versionId: "tbc",
        startTime: now + 3 * DAY,
        signupDeadline: now + 2 * DAY,
        size: 10,
        composition: { tank: 2, healer: 3, melee: 0, ranged: 0 },
        ...over,
    };
}

/** A signup to an own event: signed, with character, spec key and its role. */
function signup(over = {}) {
    return {
        userId: "u1",
        character: "Brokk",
        spec: "Warrior-Protection",
        role: "tank",
        status: "signed",
        at: 1,
        ...over,
    };
}

/** A series of one raid category (eventSeriesStore): Wednesdays 19:30, six days ahead. */
function series(over = {}) {
    return {
        categoryId: "cat1",
        enabled: true,
        weekdays: [3],
        time: "19:30",
        raidTemplateId: "tpl-ssc",
        daysBefore: 6,
        title: "",
        skipDates: [],
        ...over,
    };
}

module.exports = { event, ownEvent, signup, series, sec, DAY };

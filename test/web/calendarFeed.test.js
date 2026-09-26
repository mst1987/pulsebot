// The raider's calendar subscription (#312): which raids end up in the feed,
// and — the reason this module exists at all — that a token which was never
// minted or has been revoked gets nothing back rather than an error that says
// so. The cache is tested too: a subscribed calendar polls forever.
jest.mock("../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example" }));
jest.mock("../../src/web/eventStore", () => ({ listEvents: jest.fn(() => []) }));
jest.mock("../../src/web/signupStore", () => ({ signupsOfUser: jest.fn(() => ({})) }));

const eventStore = require("../../src/web/eventStore");
const signupStore = require("../../src/web/signupStore");
const tokens = require("../../src/web/calendarTokenStore");
const { tempStoreFile } = require("../helpers/tempStore");
const { event: baseEvent, signup: baseSignup } = require("../factories/events");
const { feedFor, collectEntries, clearCache, BACK_DAYS, FORWARD_DAYS, MAX_EVENTS, CACHE_MS } = require("../../src/web/calendarFeed");

const FILE = tempStoreFile("calendar-feed-tokens.json");
const BROKK = "111111111111111111";
const ZIBBO = "222222222222222222";
const NOW = Date.UTC(2026, 8, 20, 12, 0);
const DAY = 86400;
const sec = (offsetDays) => Math.floor(NOW / 1000) + offsetDays * DAY;

const event = (over = {}) => baseEvent({
    id: "eh-1",
    guildId: "999999999999999999",
    channelId: "888888888888888888",
    title: "SSC + TK",
    startTime: sec(4),
    durationMinutes: 180,
    updatedAt: NOW - 1000,
    status: "active",
    ...over,
});

const signup = (over = {}) => baseSignup({ userId: BROKK, at: NOW - 5000, ...over });

/** The store answers with the events the test set up, honouring the bounds. */
function haveEvents(list) {
    eventStore.listEvents.mockImplementation((guildId, opts = {}) => list
        .filter((e) => (!opts.sinceSeconds || e.startTime >= opts.sinceSeconds))
        .filter((e) => (!opts.untilSeconds || e.startTime <= opts.untilSeconds))
        .sort((a, b) => b.startTime - a.startTime));
}

beforeEach(() => {
    jest.clearAllMocks();
    tokens.useFile(FILE);
    tokens.revokeAllFor(BROKK);
    tokens.revokeAllFor(ZIBBO);
    clearCache();
    haveEvents([]);
    signupStore.signupsOfUser.mockReturnValue({});
});

afterAll(() => tokens.useFile(null));

describe("web/calendarFeed", () => {
    describe("collectEntries", () => {
        it("takes exactly the raids the raider has a signup for, soonest first", () => {
            haveEvents([event({ id: "eh-1", startTime: sec(4) }), event({ id: "eh-2", startTime: sec(1) }), event({ id: "eh-3" })]);
            signupStore.signupsOfUser.mockReturnValue({ "eh-1": signup(), "eh-2": signup({ status: "late" }) });
            const entries = collectEntries(BROKK, { now: NOW });
            expect(entries.map((e) => e.event.id)).toEqual(["eh-2", "eh-1"]);
            expect(entries.map((e) => e.status)).toEqual(["late", "signed"]);
        });

        it("carries the signup's own change time, so a status change bumps the entry", () => {
            haveEvents([event()]);
            signupStore.signupsOfUser.mockReturnValue({ "eh-1": signup({ updatedAt: NOW - 20 }) });
            expect(collectEntries(BROKK, { now: NOW })[0].changedAt).toBe(NOW - 20);
        });

        it("asks the store for a bounded window — 30 days back, 90 forward", () => {
            signupStore.signupsOfUser.mockReturnValue({ "eh-1": signup() });
            collectEntries(BROKK, { now: NOW });
            expect(eventStore.listEvents).toHaveBeenCalledWith("", {
                sinceSeconds: Math.floor(NOW / 1000) - BACK_DAYS * DAY,
                untilSeconds: Math.floor(NOW / 1000) + FORWARD_DAYS * DAY,
            });
        });

        it("drops a raid outside the window even if the store hands one over", () => {
            // the bounds are the store's job; what the module must not do is
            // grow without limit
            const many = [];
            const mine = {};
            for (let i = 0; i < MAX_EVENTS + 20; i += 1) {
                many.push(event({ id: `eh-${i}`, startTime: sec(1) + i * 60 }));
                mine[`eh-${i}`] = signup();
            }
            haveEvents(many);
            signupStore.signupsOfUser.mockReturnValue(mine);
            expect(collectEntries(BROKK, { now: NOW })).toHaveLength(MAX_EVENTS);
        });

        it("is empty without signups and without an account", () => {
            haveEvents([event()]);
            expect(collectEntries(BROKK, { now: NOW })).toEqual([]);
            expect(collectEntries("", { now: NOW })).toEqual([]);
            expect(eventStore.listEvents).not.toHaveBeenCalled();
        });

        it("ignores a signup whose event is gone — a Raid-Helper raid has none here", () => {
            haveEvents([event({ id: "eh-1" })]);
            signupStore.signupsOfUser.mockReturnValue({ "eh-1": signup(), 1234567: signup() });
            expect(collectEntries(BROKK, { now: NOW }).map((e) => e.event.id)).toEqual(["eh-1"]);
        });
    });

    describe("feedFor", () => {
        it("answers null for an unknown token — the route turns that into a plain 404", () => {
            expect(feedFor("ehc_deadbeef", { now: NOW })).toBeNull();
            expect(feedFor("", { now: NOW })).toBeNull();
            expect(feedFor("../../../etc/passwd", { now: NOW })).toBeNull();
            // nothing was even read
            expect(signupStore.signupsOfUser).not.toHaveBeenCalled();
        });

        it("answers null for a revoked token, the same as for one that never was", () => {
            const { token, record } = tokens.createToken(BROKK);
            expect(feedFor(token, { now: NOW })).toBeTruthy();
            clearCache();
            tokens.revokeToken(record.id, BROKK);
            expect(feedFor(token, { now: NOW })).toBeNull();
        });

        it("builds that raider's calendar and only theirs", () => {
            haveEvents([event()]);
            signupStore.signupsOfUser.mockImplementation((uid) => (uid === BROKK ? { "eh-1": signup() } : {}));
            const { token } = tokens.createToken(BROKK);
            const feed = feedFor(token, { now: NOW });
            expect(signupStore.signupsOfUser).toHaveBeenCalledWith(BROKK);
            expect(feed.body).toContain("UID:eh-1@eventhelper");
            expect(feed.body).toContain("SUMMARY:SSC + TK");
            expect(feed.cached).toBe(false);
        });

        it("answers an empty calendar, not a 404, for a raider without raids", () => {
            const { token } = tokens.createToken(ZIBBO);
            const feed = feedFor(token, { now: NOW });
            expect(feed.body).toContain("BEGIN:VCALENDAR");
            expect(feed.body).not.toContain("BEGIN:VEVENT");
        });

        // A subscribed calendar polls on its own schedule, several clients per
        // raider, forever — the file is built once per window.
        describe("cache", () => {
            it("serves the same body again without rebuilding", () => {
                haveEvents([event()]);
                signupStore.signupsOfUser.mockReturnValue({ "eh-1": signup() });
                const { token } = tokens.createToken(BROKK);
                const first = feedFor(token, { now: NOW });
                const second = feedFor(token, { now: NOW + 1000 });
                expect(second.cached).toBe(true);
                expect(second.body).toBe(first.body);
                expect(signupStore.signupsOfUser).toHaveBeenCalledTimes(1);
            });

            it("rebuilds once the window is over", () => {
                haveEvents([event()]);
                signupStore.signupsOfUser.mockReturnValue({ "eh-1": signup() });
                const { token } = tokens.createToken(BROKK);
                feedFor(token, { now: NOW });
                const later = feedFor(token, { now: NOW + CACHE_MS + 1 });
                expect(later.cached).toBe(false);
                expect(signupStore.signupsOfUser).toHaveBeenCalledTimes(2);
            });

            it("counts a fetch only when it really built one, so the disk stays quiet", () => {
                const { token, record } = tokens.createToken(BROKK);
                feedFor(token, { now: NOW });
                feedFor(token, { now: NOW + 1000 });
                expect(tokens.listTokensFor(BROKK).find((t) => t.id === record.id).uses).toBe(1);
            });

            it("two raiders do not see each other's calendar out of the cache", () => {
                haveEvents([event({ id: "eh-1" }), event({ id: "eh-2" })]);
                signupStore.signupsOfUser.mockImplementation((uid) => (uid === BROKK
                    ? { "eh-1": signup() }
                    : { "eh-2": signup({ userId: ZIBBO }) }));
                const a = tokens.createToken(BROKK).token;
                const b = tokens.createToken(ZIBBO).token;
                expect(feedFor(a, { now: NOW }).body).toContain("UID:eh-1@eventhelper");
                const other = feedFor(b, { now: NOW }).body;
                expect(other).toContain("UID:eh-2@eventhelper");
                expect(other).not.toContain("UID:eh-1@eventhelper");
            });
        });
    });
});

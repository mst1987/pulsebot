// The public event page (#308). Its whole point is that it is reachable without
// a login, so the tests that matter are the ones that hold the line on what may
// leave: the payload is checked against VIEW_KEYS, and the rendered HTML is
// searched for every personal thing a signup carries — user ids, comments,
// wishes, "kann auch mit", the profile and a setup draft.
jest.mock("../../../src/stores/eventStore", () => ({ getEvent: jest.fn(), setEventMessage: jest.fn(), listEvents: jest.fn(() => []) }));
jest.mock("../../../src/stores/signupStore", () => ({ listSignups: jest.fn(() => []), onSignupsChanged: jest.fn() }));
jest.mock("../../../src/web/discord", () => ({ getClient: jest.fn(() => null) }));

const eventStore = require("../../../src/stores/eventStore");
const signupStore = require("../../../src/stores/signupStore");
const {
    VIEW_KEYS, publicEventView, renderPublicEventPage, renderEventPage,
} = require("../../../src/web/pages/eventPublicPage");
const { ownEvent } = require("../../factories/events");

const NOW = Date.UTC(2026, 8, 20, 12, 0);
const START = Math.floor(Date.UTC(2026, 8, 24, 17, 30) / 1000);

// The three user ids the tests hunt for in the output.
const IDS = { brokk: "111111111111111111", zibbo: "222222222222222222", kael: "333333333333333333" };

const event = (over = {}) => ownEvent({
    id: "eh-1",
    guildId: "999999999999999999",
    channelId: "888888888888888888",
    title: "SSC + TK",
    description: "Invite 19:15",
    startTime: START,
    durationMinutes: 180,
    signupDeadline: START - 86400,
    instanceIds: ["ssc"],
    size: 25,
    composition: { tank: 2, healer: 6, melee: 0, ranged: 0 },
    status: "active",
    signupsClosed: false,
    ...over,
});

const su = (userId, character, spec, role, status = "signed", over = {}) => ({
    userId,
    character,
    spec,
    role,
    status,
    characters: [{ character, spec, role, status: status === "absence" ? undefined : status }],
    // everything below must never reach the page
    comment: "komme 20:30, Frau ist krank",
    canAlso: ["healer"],
    at: 1,
    ...over,
});

const signups = () => [
    su(IDS.brokk, "Brokk", "Warrior-Protection", "tank"),
    su(IDS.zibbo, "Zibbo", "Priest-Holy", "healer"),
    su(IDS.kael, "Kael", "Mage-Fire", "ranged", "bench"),
];

/** Every key name the payload uses, at every level. */
function keysOf(value, out = new Set()) {
    if (Array.isArray(value)) {
        for (const v of value) keysOf(v, out);
        return out;
    }
    if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) {
            out.add(k);
            keysOf(v, out);
        }
    }
    return out;
}

describe("web/pages/eventPublicPage", () => {
    describe("publicEventView", () => {
        it("carries nothing but the allowed fields", () => {
            const view = publicEventView(event(), signups(), { now: NOW });
            const unknown = [...keysOf(view)].filter((k) => !VIEW_KEYS.includes(k));
            expect(unknown).toEqual([]);
        });

        it("names the raid, the times and the counts", () => {
            const view = publicEventView(event(), signups(), { now: NOW });
            expect(view.title).toBe("SSC + TK");
            expect(view.startTime).toBe(START);
            expect(view.endTime).toBe(START + 3 * 3600);
            expect(view.size).toBe(25);
            expect(view.raids.map((r) => r.id)).toEqual(["ssc"]);
            expect(view.counts).toEqual({ attending: 2, tank: 1, healer: 1, dps: 0, tentative: 0, bench: 1, absence: 0 });
            expect(view.icsUrl).toBe("/r/cal/eh-1.ics");
            expect(view.phase).toBe("open");
        });

        it("groups the signups by class, with the character and the spec and nothing else", () => {
            const view = publicEventView(event(), signups(), { now: NOW });
            expect(view.classes.map((c) => c.id)).toEqual(["Warrior", "Priest"]);
            expect(view.classes[0].members).toEqual([
                { character: "Brokk", spec: "Warrior-Protection", specLabel: "Protection", specIcon: "ability_warrior_defensivestance", role: "tank" },
            ]);
            // the bench is its own block, not a class one
            expect(view.other.map((o) => [o.id, o.members.map((m) => m.character)])).toEqual([["bench", ["Kael"]]]);
        });

        it("keeps a spec the rule set no longer knows instead of dropping the raider", () => {
            const view = publicEventView(event(), [su(IDS.brokk, "Brokk", "Warrior-Gladiator", "melee")], { now: NOW });
            const rest = view.classes.find((c) => c.label === "Other");
            expect(rest.members.map((m) => m.character)).toEqual(["Brokk"]);
        });

        it("shows the approved setup and never a draft", () => {
            const approved = {
                approvedAt: 1700000000000,
                groups: [{ index: 1, slots: [{ userId: IDS.brokk, character: "Brokk", spec: "Warrior-Protection", role: "tank", reasons: ["War zuletzt auf der Bank"], locked: true }] }],
                bench: [{ userId: IDS.kael, character: "Kael", spec: "Mage-Fire", role: "ranged", reasons: ["Raid voll"] }],
            };
            const withDraft = publicEventView(event({ setup: { status: "draft", groups: approved.groups, bench: [] } }), signups(), { now: NOW });
            expect(withDraft.setup).toBe(null);

            const view = publicEventView(event({ setup: { status: "approved", approved } }), signups(), { now: NOW });
            expect(view.setup.groups).toEqual([{ index: 1, members: [{ character: "Brokk", spec: "Warrior-Protection", specLabel: "Protection", specIcon: "ability_warrior_defensivestance", role: "tank" }] }]);
            expect(view.setup.bench.map((b) => b.character)).toEqual(["Kael"]);
            expect(JSON.stringify(view.setup)).not.toContain("War zuletzt");
            expect(JSON.stringify(view.setup)).not.toContain(IDS.brokk);
        });

        it("says when the event is cancelled or its signup closed", () => {
            const cancelled = publicEventView(event({ status: "cancelled", cancel: { reason: "Zu wenige Heiler" } }), signups(), { now: NOW });
            expect(cancelled.status).toBe("cancelled");
            expect(cancelled.phase).toBe("cancelled");
            expect(cancelled.cancelReason).toBe("Zu wenige Heiler");

            const closed = publicEventView(event({ signupsClosed: true }), signups(), { now: NOW });
            expect(closed.phase).toBe("closed");
            expect(closed.signupsClosed).toBe(true);
        });

        it("is null without an event", () => {
            expect(publicEventView(null, [])).toBe(null);
            expect(publicEventView({}, [])).toBe(null);
        });
    });

    describe("nothing personal leaves the page", () => {
        const full = () => event({
            leaderId: IDS.brokk,
            setup: {
                status: "approved",
                approved: {
                    approvedAt: 1,
                    groups: [{ index: 1, slots: [{ userId: IDS.brokk, character: "Brokk", spec: "Warrior-Protection", role: "tank", reasons: ["Wunsch erfüllt: mit Zibbo (gegenseitig)"] }] }],
                    bench: [],
                },
                // a draft sitting next to the approval must not leak either
                groups: [{ index: 1, slots: [{ userId: IDS.kael, character: "GeheimerEntwurf", spec: "Mage-Fire", role: "ranged" }] }],
            },
        });
        const list = () => [
            ...signups(),
            su(IDS.brokk, "Brokk", "Warrior-Protection", "tank", "signed", {
                canAlso: ["healer"],
                comment: "komme 20:30",
                characters: [
                    { character: "Brokk", spec: "Warrior-Protection", role: "tank", status: "signed" },
                    { character: "Brokkheal", spec: "Priest-Holy", role: "healer", status: "signed" },
                ],
            }),
        ];

        it("neither the payload nor the HTML names a user id, a comment, a wish or a draft", () => {
            const view = publicEventView(full(), list(), { now: NOW });
            const html = renderPublicEventPage(view);
            for (const text of [JSON.stringify(view), html]) {
                for (const id of Object.values(IDS)) expect(text).not.toContain(id);
                expect(text).not.toContain("komme 20:30");
                expect(text).not.toContain("Wunsch");
                expect(text).not.toContain("GeheimerEntwurf");
                expect(text.toLowerCase()).not.toContain("canalso");
                expect(text).not.toContain("kann auch");
            }
        });

        it("carries no Discord link at all — a link is an id, and a visitor need not be on the server", () => {
            const html = renderPublicEventPage(publicEventView(full(), list(), { now: NOW }));
            expect(html).not.toContain("discord.com/channels");
            expect(html).not.toContain("999999999999999999");
            expect(html).not.toContain("888888888888888888");
        });

        it("lists the alternate characters a raider named — they are on the roster, not a secret", () => {
            // "kann auch mit" is the wording and the profile's business; the characters
            // themselves stand in the channel's message too, so they stand here.
            const html = renderPublicEventPage(publicEventView(full(), list(), { now: NOW }));
            expect(html).toContain("Brokkheal");
        });
    });

    describe("renderPublicEventPage", () => {
        it("renders a whole page with the raid, the roster and both links", () => {
            const html = renderPublicEventPage(publicEventView(event(), signups(), { now: NOW }));
            expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
            expect(html).toContain("SSC + TK");
            expect(html).toContain("Brokk");
            expect(html).toContain("/r/cal/eh-1.ics");
            expect(html).toContain("/signups?event=eh-1");
            expect(html).toContain("Add to calendar");
        });

        it("is in English with the times written out in server time (no Discord timestamps on the web)", () => {
            const html = renderPublicEventPage(publicEventView(event(), signups(), { now: NOW }));
            expect(html).toContain("<html lang=\"en\">");
            // 17:30 UTC on 24 Sep 2026 is 19:30 in Berlin; the end three hours later
            expect(html).toContain("Thu 24 Sep 2026, 19:30");
            expect(html).toContain("until 22:30 server time");
            expect(html).toContain("Wed 23 Sep 2026, 19:30");
            expect(html).toContain("25-man");
            for (const word of ["Signed up", "Signup deadline", "Priest", "Warrior", "Bench", "Signups"]) expect(html).toContain(word);
            for (const german of ["Angemeldet", "Anmeldeschluss", "Priester", "Krieger", "Bank", " Uhr", "Termin"]) expect(html).not.toContain(german);
            expect(html).not.toContain("<t:");
        });

        it("escapes a character name instead of letting it write HTML", () => {
            const html = renderPublicEventPage(publicEventView(event(), [su(IDS.brokk, "<img src=x onerror=alert(1)>", "Mage-Fire", "ranged")], { now: NOW }));
            expect(html).not.toContain("<img src=x");
            expect(html).toContain("&lt;img src=x");
        });

        it("says so when nobody signed up", () => {
            expect(renderPublicEventPage(publicEventView(event(), [], { now: NOW }))).toContain("Nobody has signed up yet");
        });
    });

    describe("renderEventPage", () => {
        it("reads the stores and renders the page", () => {
            eventStore.getEvent.mockReturnValue(event());
            signupStore.listSignups.mockReturnValue(signups());
            const html = renderEventPage("eh-1", { now: NOW });
            expect(eventStore.getEvent).toHaveBeenCalledWith("eh-1");
            expect(html).toContain("SSC + TK");
        });

        it("is null for an unknown event, so the route can 404", () => {
            eventStore.getEvent.mockReturnValue(null);
            expect(renderEventPage("eh-nope")).toBe(null);
        });
    });
});

// The calendar file of an event (#308). Everything here is what a calendar
// client is unforgiving about: folding at 75 octets, escaping, UTC times and a
// cancelled event — plus the line that nothing personal is in the file.
jest.mock("../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example" }));

const {
    buildIcs, buildUserCalendar, foldLine, escapeText, icsTime,
    icsUrlFor, publicEventUrl, userIcsUrl, icsFileName,
} = require("../../src/web/icsFeed");

// 2026-09-24 19:30 UTC
const START = Math.floor(Date.UTC(2026, 8, 24, 19, 30) / 1000);
const CHANGED = 1790000000000;

const event = (over = {}) => ({
    id: "eh-1",
    guildId: "111111111111111111",
    channelId: "222222222222222222",
    title: "SSC + TK",
    description: "Invite 19:15",
    startTime: START,
    durationMinutes: 180,
    updatedAt: CHANGED,
    createdAt: CHANGED - 1000,
    status: "active",
    ...over,
});

/** The file back as single logical lines (RFC 5545 unfolding). */
const unfold = (ics) => ics.replace(/\r\n /g, "").split("\r\n").filter(Boolean);
const lineOf = (ics, name) => unfold(ics).find((l) => l.startsWith(`${name}:`)) || "";

describe("web/icsFeed", () => {
    describe("foldLine", () => {
        it("keeps a short line as it is", () => {
            expect(foldLine("SUMMARY:Raid")).toBe("SUMMARY:Raid");
        });

        it("folds at 75 octets, continuation lines start with one space", () => {
            const folded = foldLine(`SUMMARY:${"a".repeat(200)}`).split("\r\n");
            expect(folded.length).toBeGreaterThan(1);
            expect(folded[0]).toHaveLength(75);
            for (const part of folded.slice(1)) {
                expect(part.startsWith(" ")).toBe(true);
                expect(Buffer.byteLength(part, "utf8")).toBeLessThanOrEqual(75);
            }
            expect(folded.join("\r\n").replace(/\r\n /g, "")).toBe(`SUMMARY:${"a".repeat(200)}`);
        });

        it("counts octets, never splitting a multi-byte character", () => {
            const folded = foldLine(`SUMMARY:${"ü".repeat(80)}`).split("\r\n");
            for (const part of folded) {
                expect(Buffer.byteLength(part, "utf8")).toBeLessThanOrEqual(75);
                expect(part).not.toContain("�");
            }
            expect(folded.join("\r\n").replace(/\r\n /g, "")).toBe(`SUMMARY:${"ü".repeat(80)}`);
        });
    });

    describe("escapeText", () => {
        it("escapes backslash, semicolon, comma and newlines — in that order", () => {
            expect(escapeText("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne");
            expect(escapeText("a\r\nb")).toBe("a\\nb");
            expect(escapeText(null)).toBe("");
        });
    });

    describe("icsTime", () => {
        it("is UTC with the Z suffix", () => {
            expect(icsTime(START)).toBe("20260924T193000Z");
            expect(icsTime(0)).toBe("19700101T000000Z");
        });
    });

    describe("buildIcs", () => {
        it("writes one VEVENT with CRLF endings", () => {
            const ics = buildIcs(event());
            expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
            expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
            expect(ics).toContain("\r\nBEGIN:VEVENT\r\n");
            expect(ics.split("\n").every((l) => l === "" || l.endsWith("\r"))).toBe(true);
            expect(ics).toContain("VERSION:2.0");
        });

        it("uses the event id as the UID and the last change as DTSTAMP/SEQUENCE", () => {
            const ics = buildIcs(event());
            expect(lineOf(ics, "UID")).toBe("UID:eh-1@eventhelper");
            expect(lineOf(ics, "DTSTAMP")).toBe(`DTSTAMP:${icsTime(Math.floor(CHANGED / 1000))}`);
            const seq = Number(lineOf(ics, "SEQUENCE").slice("SEQUENCE:".length));
            expect(seq).toBeGreaterThan(0);
            expect(seq).toBeLessThan(2 ** 31);
            // a later change means a higher sequence
            const later = Number(unfold(buildIcs(event({ updatedAt: CHANGED + 60000 })))
                .find((l) => l.startsWith("SEQUENCE:")).slice("SEQUENCE:".length));
            expect(later).toBeGreaterThan(seq);
        });

        it("takes the end from the duration (#305) and three hours without one", () => {
            expect(lineOf(buildIcs(event({ durationMinutes: 240 })), "DTEND")).toBe(`DTEND:${icsTime(START + 4 * 3600)}`);
            // an event stored before #305 reads as the default duration of 3 h
            expect(lineOf(buildIcs(event({ durationMinutes: undefined })), "DTEND")).toBe(`DTEND:${icsTime(START + 3 * 3600)}`);
            expect(lineOf(buildIcs(event()), "DTSTART")).toBe(`DTSTART:${icsTime(START)}`);
        });

        it("points at the event channel and the public page", () => {
            const ics = buildIcs(event());
            expect(lineOf(ics, "LOCATION")).toBe("LOCATION:https://discord.com/channels/111111111111111111/222222222222222222");
            expect(lineOf(ics, "URL")).toBe("URL:https://eh.example/e/eh-1");
            expect(lineOf(ics, "DESCRIPTION")).toContain("https://eh.example/e/eh-1");
            expect(lineOf(ics, "STATUS")).toBe("STATUS:CONFIRMED");
        });

        it("leaves the location out when the event has no channel", () => {
            expect(buildIcs(event({ channelId: "" }))).not.toContain("LOCATION:");
        });

        it("marks a cancelled event and names the reason", () => {
            const ics = buildIcs(event({ status: "cancelled", cancel: { reason: "Zu wenige Heiler" } }));
            expect(lineOf(ics, "STATUS")).toBe("STATUS:CANCELLED");
            expect(lineOf(ics, "SUMMARY")).toBe("SUMMARY:Cancelled: SSC + TK");
            expect(lineOf(ics, "DESCRIPTION")).toContain("Cancelled: Zu wenige Heiler");
        });

        it("escapes the title and the description instead of breaking the file", () => {
            const ics = buildIcs(event({ title: "SSC, TK; T6", description: "Zeile 1\nZeile 2" }));
            expect(lineOf(ics, "SUMMARY")).toBe("SUMMARY:SSC\\, TK\\; T6");
            expect(lineOf(ics, "DESCRIPTION")).toContain("Zeile 1\\nZeile 2");
        });

        it("folds a long title so no line passes 75 octets", () => {
            const ics = buildIcs(event({ title: "Ü".repeat(120) }));
            for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
        });

        it("answers empty for an event without an id or without a start", () => {
            expect(buildIcs(null)).toBe("");
            expect(buildIcs(event({ startTime: 0 }))).toBe("");
            expect(buildIcs(event({ id: "" }))).toBe("");
        });

        it("carries nothing personal — no raider, no leader, no user id", () => {
            const ics = buildIcs(event({ leaderId: "333333333333333333", description: "Invite 19:15" }));
            expect(ics).not.toContain("333333333333333333");
            expect(ics.toLowerCase()).not.toContain("leader");
            expect(ics).not.toContain("ATTENDEE");
            expect(ics).not.toContain("ORGANIZER");
        });
    });

    describe("links", () => {
        it("builds the public urls from the configured base", () => {
            expect(icsUrlFor("eh-1")).toBe("https://eh.example/r/cal/eh-1.ics");
            expect(publicEventUrl("eh-1")).toBe("https://eh.example/e/eh-1");
            expect(icsUrlFor("")).toBe("");
        });

        it("names the downloaded file after the event, without anything odd in it", () => {
            expect(icsFileName("eh-1")).toBe("raid-eh-1.ics");
            expect(icsFileName("../../etc/passwd")).toBe("raid-etcpasswd.ics");
        });

        it("builds the subscription url from the token", () => {
            expect(userIcsUrl("ehc_abc")).toBe("https://eh.example/r/cal/user/ehc_abc.ics");
            expect(userIcsUrl("")).toBe("");
        });
    });

    // ---- the raider's subscription (#312) ----
    //
    // The route behind this file is reachable with nothing but the token in the
    // url, so the line it holds is: the raids, their times, and the *reader's
    // own* status — never a word about anybody else.
    describe("buildUserCalendar", () => {
        // Every property name a VEVENT of this feed may carry. A new one has to
        // be added here on purpose, which is the point.
        const ALLOWED = new Set([
            "BEGIN", "END", "VERSION", "PRODID", "CALSCALE", "METHOD", "X-WR-CALNAME", "NAME",
            "UID", "DTSTAMP", "SEQUENCE", "DTSTART", "DTEND", "SUMMARY", "DESCRIPTION",
            "LOCATION", "URL", "STATUS", "TRANSP",
        ]);

        const entries = [
            { event: event({ id: "eh-1", title: "SSC + TK", startTime: START }), status: "signed", changedAt: CHANGED },
            { event: event({ id: "eh-2", title: "Hyjal", startTime: START + 7 * 86400 }), status: "bench", changedAt: CHANGED },
        ];

        it("writes one VCALENDAR with a VEVENT per raid, soonest first as handed in", () => {
            const ics = buildUserCalendar(entries);
            expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
            expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
            expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
            expect(unfold(ics).filter((l) => l.startsWith("UID:"))).toEqual([
                "UID:eh-1@eventhelper", "UID:eh-2@eventhelper",
            ]);
            // the name a calendar client shows for the subscription
            expect(ics).toContain("X-WR-CALNAME:My raids");
        });

        it("is a valid, empty calendar for a raider without a single signup", () => {
            const ics = buildUserCalendar([]);
            expect(ics).toContain("BEGIN:VCALENDAR");
            expect(ics).toContain("END:VCALENDAR");
            expect(ics).not.toContain("BEGIN:VEVENT");
        });

        it("names the reader's own status and nothing else about the signup", () => {
            const ics = buildUserCalendar([{ event: event(), status: "late" }]);
            expect(lineOf(ics, "DESCRIPTION")).toContain("Your signup: Late");
            expect(lineOf(ics, "STATUS")).toBe("STATUS:CONFIRMED");
        });

        // Dropping the VEVENT would leave the raid standing in every calendar
        // that already fetched it; CANCELLED makes the client strike it.
        it("keeps an own absence as CANCELLED instead of dropping it", () => {
            const ics = buildUserCalendar([{ event: event(), status: "absence" }]);
            expect(ics).toContain("BEGIN:VEVENT");
            expect(lineOf(ics, "STATUS")).toBe("STATUS:CANCELLED");
            expect(lineOf(ics, "SUMMARY")).toBe("SUMMARY:Signed off: SSC + TK");
        });

        it("marks a cancelled raid as cancelled whatever the own status is", () => {
            const ics = buildUserCalendar([{ event: event({ status: "cancelled", cancel: { reason: "Zu wenige Heiler" } }), status: "signed" }]);
            expect(lineOf(ics, "STATUS")).toBe("STATUS:CANCELLED");
            expect(lineOf(ics, "DESCRIPTION")).toContain("Cancelled: Zu wenige Heiler");
        });

        it("blocks the day only for a raid one is really in", () => {
            const transp = (status) => lineOf(buildUserCalendar([{ event: event(), status }]), "TRANSP");
            expect(transp("signed")).toBe("TRANSP:OPAQUE");
            expect(transp("late")).toBe("TRANSP:OPAQUE");
            expect(transp("tentative")).toBe("TRANSP:TRANSPARENT");
            expect(transp("bench")).toBe("TRANSP:TRANSPARENT");
            expect(transp("absence")).toBe("TRANSP:TRANSPARENT");
        });

        // A calendar client may ignore an update whose SEQUENCE did not grow.
        it("lets a later signup change raise DTSTAMP and SEQUENCE", () => {
            const seq = (changedAt) => Number(lineOf(buildUserCalendar([{ event: event(), status: "signed", changedAt }]), "SEQUENCE").slice("SEQUENCE:".length));
            expect(seq(CHANGED + 600000)).toBeGreaterThan(seq(0));
            // an older signup change never lowers it below the event's own
            expect(seq(1)).toBe(seq(0));
        });

        it("skips an entry without an event or without a start", () => {
            const ics = buildUserCalendar([{ event: null }, { event: event({ startTime: 0 }) }, { event: event() }]);
            expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
            expect(buildUserCalendar(null)).not.toContain("BEGIN:VEVENT");
        });

        it("folds and escapes exactly like the single-event file", () => {
            const ics = buildUserCalendar([{ event: event({ title: "SSC, TK; Ü".repeat(12) }), status: "signed" }]);
            for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
            expect(unfold(ics).find((l) => l.startsWith("SUMMARY:"))).toContain("SSC\\, TK\\; Ü");
        });

        // ---- the allowlist ----
        it("carries no property outside the allowlist", () => {
            const ics = buildUserCalendar(entries);
            for (const line of unfold(ics)) {
                const name = line.split(/[;:]/)[0];
                expect(ALLOWED.has(name)).toBe(true);
            }
            expect(ics).not.toContain("ATTENDEE");
            expect(ics).not.toContain("ORGANIZER");
        });

        it("says nothing about another raider — no name, no id, no comment, no setup", () => {
            // The signup the feed is built from carries all of this; none of it
            // is an argument of the builder, and none of it may appear anyway.
            const ics = buildUserCalendar([{
                event: event({ leaderId: "333333333333333333" }),
                status: "signed",
                // fields a caller might carelessly hand along
                userId: "444444444444444444",
                character: "Zibbo",
                comment: "komme 20:30",
                signup: { comment: "komme 20:30", characters: [{ character: "Zibbo" }] },
            }]);
            for (const secret of ["333333333333333333", "444444444444444444", "Zibbo", "komme 20:30"]) {
                expect(ics).not.toContain(secret);
            }
            expect(ics.toLowerCase()).not.toContain("setup");
            expect(ics.toLowerCase()).not.toContain("leader");
        });
    });
});

// The raid overview message of a category (services/events/raidOverviewPanel.js): pure.
const { DateTime } = require("luxon");
const { raidOverviewPayload, payloadHash, groupByRaidId, fillLine, MAX_IDS, MAX_RAIDS } = require("../../../src/services/events/raidOverviewPanel");
const { cardText, cardButtons } = require("../../helpers/cardText");

const at = (iso) => Math.floor(DateTime.fromISO(iso, { zone: "Europe/Berlin" }).toSeconds());
// Wednesday 14 Oct 2026, 12:00 - the running ID is 14.10. - 20.10.
const NOW = DateTime.fromISO("2026-10-14T12:00:00", { zone: "Europe/Berlin" }).toMillis();
const attending = (e) => (e.signUps || []).length;
const raid = (id, iso, over = {}) => ({
    id, title: `Raid ${id}`, startTime: at(iso), channelId: `ch-${id}`, leaderId: `lead-${id}`, size: 25, signUps: [], ...over,
});
const build = (events, over = {}) => raidOverviewPayload({ categoryName: "🔥 PUG Raids", events, now: NOW, lang: "en", attending, ...over });
const texts = (payload) => cardText(payload);

describe("services/events/raidOverviewPanel", () => {
    it("is one V2 container: heading, groups by raid ID, footer - and no buttons", () => {
        const payload = build([
            raid("a", "2026-10-17T20:00:00", { signUps: Array.from({ length: 17 }, (_, i) => ({ userId: `u${i}` })) }),
            raid("b", "2026-10-21T20:00:00"),
            raid("c", "2026-10-30T20:00:00"),
        ]);
        expect(payload.flags).toBeGreaterThan(0);
        expect(payload.content).toBe("");
        expect(payload.embeds).toEqual([]);
        expect(payload.components).toHaveLength(1);
        const text = texts(payload);
        expect(text).toContain("## PUG Raids");
        expect(text).toContain("**This ID** · Wed 14.10. – Tue 20.10.");
        expect(text).toContain("**Next ID** · Wed 21.10. – Tue 27.10.");
        expect(text).toContain("**ID** · Wed 28.10. – Tue 03.11.");
        // the per-raid lines
        expect(text).toContain(`Sat 17.10. · **Raid a** · <t:${at("2026-10-17T20:00:00")}:t> · <t:${at("2026-10-17T20:00:00")}:R>`);
        expect(text).toContain("<#ch-a> · led by <@lead-a>");
        expect(text).toContain("-# 17 / 25 signed up");
        expect(cardButtons(payload)).toEqual([]);
    });

    it("writes German weekdays and texts in German", () => {
        const text = texts(build([raid("a", "2026-10-17T20:00:00")], { lang: "de" }));
        expect(text).toContain("**Diese ID** · Mi 14.10. – Di 20.10.");
        expect(text).toContain("Sa 17.10.");
        expect(text).toContain("geleitet von <@lead-a>");
        expect(text).toContain("0 / 25 angemeldet");
        expect(text).toContain("Aktualisiert sich selbst");
    });

    it("groups by lockout week, not by calendar week (Tuesday 23:30 and Wednesday 03:00 stay in the earlier ID)", () => {
        const groups = groupByRaidId([
            raid("tue", "2026-10-20T23:30:00"),
            raid("wedEarly", "2026-10-21T03:00:00"),
            raid("wedLate", "2026-10-21T06:00:00"),
        ], NOW);
        expect(groups.map((g) => g.events.map((e) => e.id))).toEqual([["tue", "wedEarly"], ["wedLate"]]);
    });

    it("leaves out cancelled raids and raids that began, and sorts by start", () => {
        const groups = groupByRaidId([
            raid("late", "2026-10-18T20:00:00"),
            raid("gone", "2026-10-15T20:00:00", { status: "cancelled" }),
            raid("past", "2026-10-13T20:00:00"),
            raid("soon", "2026-10-16T20:00:00"),
        ], NOW);
        expect(groups).toHaveLength(1);
        expect(groups[0].events.map((e) => e.id)).toEqual(["soon", "late"]);
    });

    it("omits the leader and channel when they are unknown, and escapes markdown in titles", () => {
        const text = texts(build([raid("a", "2026-10-17T20:00:00", { leaderId: "", channelId: "", title: "**Big** [raid]_x" })]));
        expect(text).toContain("**Big raidx**");
        expect(text).not.toContain("led by");
        expect(text).not.toContain("<#");
    });

    it("says so when no raid is planned", () => {
        const text = texts(build([]));
        expect(text).toContain("No raids are planned right now.");
        expect(text).not.toContain("**This ID**");
    });

    describe("fill line", () => {
        const n = NOW;
        it("counts against the size", () => {
            expect(fillLine({ size: 25 }, 17, "en", n)).toBe("17 / 25 signed up");
            expect(fillLine({}, 4, "en", n)).toBe("4 signed up");
        });

        it("says full, and whether the waiting list takes more", () => {
            expect(fillLine({ size: 10 }, 10, "en", n)).toBe("10 / 10 full");
            expect(fillLine({ size: 10, overflow: "waitlist" }, 12, "en", n)).toBe("12 / 10 full · waiting list open");
            expect(fillLine({ size: 10, overflow: "waitlist" }, 10, "de", n)).toBe("10 / 10 voll · Warteliste offen");
        });

        it("says closed when the orga closed the signup or the deadline passed", () => {
            expect(fillLine({ size: 10, signupsClosed: true }, 3, "en", n)).toBe("signups closed");
            expect(fillLine({ size: 10, signupDeadline: Math.floor(n / 1000) - 5 }, 3, "en", n)).toBe("signups closed");
            expect(fillLine({ size: 10, signupDeadline: Math.floor(n / 1000) + 500 }, 3, "en", n)).toBe("3 / 10 signed up");
        });
    });

    describe("limits", () => {
        it("lists at most three IDs and fifteen raids, with a '+n more' line", () => {
            const many = [];
            for (let week = 0; week < 5; week++) {
                for (let i = 0; i < 6; i++) {
                    many.push(raid(`w${week}r${i}`, DateTime.fromISO("2026-10-14T18:00:00", { zone: "Europe/Berlin" }).plus({ days: week * 7 + i }).toISO()));
                }
            }
            const payload = build(many);
            const text = texts(payload);
            const listed = (text.match(/<#ch-/g) || []).length;
            expect(listed).toBeLessThanOrEqual(MAX_RAIDS);
            expect((text.match(/Wed \d\d\.\d\d\. –/g) || []).length).toBeLessThanOrEqual(MAX_IDS);
            expect(text).toContain(`+${many.length - listed} more raids`);
        });

        it("stays within Discord's 40 components and 4000 characters, whatever the titles", () => {
            const events = Array.from({ length: 40 }, (_, i) => raid(`r${i}`, DateTime.fromISO("2026-10-14T18:00:00", { zone: "Europe/Berlin" }).plus({ days: i % 20, minutes: i }).toISO(), { title: "T".repeat(180) }));
            const payload = build(events);
            const count = (node) => 1 + (node.components || []).reduce((n, c) => n + count(c), 0);
            expect(count(payload.components[0])).toBeLessThanOrEqual(40);
            expect(texts(payload).length).toBeLessThan(4000);
            expect(texts(payload)).toMatch(/\+\d+ more raids/);
        });
    });

    describe("footer and hash", () => {
        it("shows the last change only when given, and leaves it out of the hash", () => {
            const events = [raid("a", "2026-10-17T20:00:00")];
            const without = build(events);
            const withTime = build(events, { lastChange: 1760000000 });
            expect(texts(without)).toContain("-# Updates itself");
            expect(texts(without)).not.toContain("last change");
            expect(texts(withTime)).toContain("-# Updates itself · last change <t:1760000000:t>");
            expect(payloadHash(without, "en")).toBe(payloadHash(build(events), "en"));
        });

        it("changes the hash with the content and the language", () => {
            const a = build([raid("a", "2026-10-17T20:00:00")]);
            const b = build([raid("a", "2026-10-17T20:00:00", { signUps: [{ userId: "u1" }] })]);
            expect(payloadHash(a, "en")).not.toBe(payloadHash(b, "en"));
            expect(payloadHash(a, "en")).not.toBe(payloadHash(a, "de"));
        });
    });
});

// The raid overview message of a category (services/events/raidOverviewPanel.js): pure.
const { DateTime } = require("luxon");
const { raidOverviewPayload, shownRaids, payloadHash, groupByRaidId, fillLine, fillBar, raidPicture, MAX_IDS, MAX_RAIDS, MAX_COMPONENTS } = require("../../../src/services/events/raidOverviewPanel");
const { cardText, cardButtons, nodes } = require("../../helpers/cardText");

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
        expect(text).toContain(`**Sat 17.10.** · **Raid a** · <t:${at("2026-10-17T20:00:00")}:t> · <t:${at("2026-10-17T20:00:00")}:R>`);
        expect(text).toContain("<#ch-a> · led by <@lead-a>");
        expect(text).toContain("🟩🟩🟩▫️▫️ 17 / 25 signed up");
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
            // shownRaids names exactly the raids the card lists
            const shown = shownRaids({ categoryName: "🔥 PUG Raids", events: many, now: NOW, lang: "en", attending });
            expect(shown).toHaveLength(listed);
            expect(shown.every((e) => text.includes(`<#${e.channelId}>`))).toBe(true);
        });

        it("names no raid when nothing is planned", () => {
            expect(shownRaids({ events: [], now: NOW, lang: "en", attending })).toEqual([]);
            expect(shownRaids()).toEqual([]);
        });

        it("lists an upcoming raid with the defaults (now, German, the app's emojis, category form)", () => {
            const later = { id: "x", title: "Kara", startTime: Math.floor(Date.now() / 1000) + 3600, channelId: "c1" };
            expect(shownRaids({ events: [later], attending: () => 0 })).toEqual([later]);
        });

        it("stays within Discord's 40 components and 4000 characters, whatever the titles", () => {
            const events = Array.from({ length: 40 }, (_, i) => raid(`r${i}`, DateTime.fromISO("2026-10-14T18:00:00", { zone: "Europe/Berlin" }).plus({ days: i % 20, minutes: i }).toISO(), { title: "T".repeat(180) }));
            const payload = build(events);
            const count = (node) => 1 + (node.components || []).reduce((n, c) => n + count(c), 0);
            expect(count(payload.components[0])).toBeLessThanOrEqual(MAX_COMPONENTS);
            expect(texts(payload).length).toBeLessThan(4000);
            expect(texts(payload)).toMatch(/\+\d+ more raids/);
        });
    });

    describe("zone picture", () => {
        const sections = (payload) => nodes(payload).filter((n) => n.type === 9);
        const ART = "https://render.worldofwarcraft.com/eu/zones/gruuls-lair-small.jpg";

        it("puts the zone art of the instances into a Section's thumbnail", () => {
            const payload = build([raid("a", "2026-10-17T20:00:00", { instanceIds: ["gruul"] })]);
            const [section] = sections(payload);
            expect(section.accessory.type).toBe(11);
            expect(section.accessory.media.url).toBe(ART);
            expect(section.components[0].content).toContain("**Raid a**");
        });

        it("prefers the event's own image", () => {
            const own = "https://example.com/own.png";
            const event = raid("a", "2026-10-17T20:00:00", { instanceIds: ["gruul"], image: { url: own, mode: "banner" } });
            expect(raidPicture(event)).toBe(own);
            expect(sections(build([event]))[0].accessory.media.url).toBe(own);
        });

        it("ignores an own image that is not https and falls back to the zone art", () => {
            const event = raid("a", "2026-10-17T20:00:00", { instanceIds: ["gruul"], image: { url: "http://example.com/x.png" } });
            expect(raidPicture(event)).toBe(ART);
        });

        it("reads the instances from the title of a Raid-Helper row", () => {
            const payload = build([raid("a", "2026-10-17T20:00:00", { title: "Gruul", size: 0 })]);
            expect(sections(payload)).toHaveLength(1);
            expect(sections(payload)[0].accessory.media.url).toBe(ART);
        });

        it("is a plain text display without any picture", () => {
            const payload = build([raid("a", "2026-10-17T20:00:00", { title: "Movie night" })]);
            expect(sections(payload)).toHaveLength(0);
            expect(texts(payload)).toContain("**Movie night**");
        });

        it("stays within 40 components with a picture on every raid", () => {
            const events = Array.from({ length: 20 }, (_, i) => raid("r" + i, DateTime.fromISO("2026-10-14T18:00:00", { zone: "Europe/Berlin" }).plus({ hours: 5 * i }).toISO(), { instanceIds: ["gruul"] }));
            const payload = build(events);
            expect(1 + nodes(payload).length).toBeLessThanOrEqual(MAX_COMPONENTS + 1);
            expect(sections(payload).length).toBeGreaterThan(5);
            expect(texts(payload)).toMatch(/\+\d+ more raids/);
        });
    });

    describe("fill bar", () => {
        const ids = { g: "1", o: "2", n: "3", e: "4" };
        const emojis = {};
        for (const k of Object.keys(ids)) emojis["eh_ui_bar" + k] = { id: ids[k], name: "eh_ui_bar" + k };
        const e = (k) => "<:eh_ui_bar" + k + ":" + ids[k] + ">";
        const bar = (counts, size = 25) => fillBar({ size }, counts, emojis);

        it("is all empty with nobody signed up", () => {
            expect(bar(0)).toBe(e("e").repeat(5));
        });

        it("is grey while under a third (at least one segment once somebody is in)", () => {
            expect(bar(1)).toBe(e("n") + e("e").repeat(4));
            expect(bar(8)).toBe(e("n").repeat(2) + e("e").repeat(3));
        });

        it("is green in between", () => {
            expect(bar(13)).toBe(e("g").repeat(3) + e("e").repeat(2));
            expect(bar(24)).toBe(e("g").repeat(5));
        });

        it("is orange when full", () => {
            expect(bar(25)).toBe(e("o").repeat(5));
            expect(bar(30)).toBe(e("o").repeat(5));
        });

        it("has no bar without a size, and falls back to unicode without the emojis", () => {
            expect(fillBar({}, 4, emojis)).toBe("");
            expect(fillBar({ size: 25 }, 25, {})).toBe("🟧🟧🟧🟧🟧");
            expect(fillBar({ size: 25 }, 13, {})).toBe("🟩🟩🟩▫️▫️");
            expect(fillBar({ size: 25 }, 1, {})).toBe("⬜▫️▫️▫️▫️");
        });

        it("goes before the fill line, and the small icons before time, leader and ID", () => {
            const icons = { ...emojis, eh_ui_time: { id: "5", name: "eh_ui_time" }, eh_ui_leader: { id: "6", name: "eh_ui_leader" }, eh_ui_date: { id: "7", name: "eh_ui_date" } };
            const text = texts(build([raid("a", "2026-10-17T20:00:00", { signUps: Array.from({ length: 13 }, (_, i) => ({ userId: "u" + i })) })], { emojis: icons }));
            expect(text).toContain("-# " + e("g").repeat(3) + e("e").repeat(2) + " 13 / 25 signed up");
            expect(text).toContain("<:eh_ui_time:5> <t:");
            expect(text).toContain("<:eh_ui_leader:6> led by <@lead-a>");
            expect(text).toContain("<:eh_ui_date:7> **This ID**");
        });

        it("gives Raid-Helper rows just the count", () => {
            const text = texts(build([raid("a", "2026-10-17T20:00:00", { size: 0, signUps: [{ userId: "u" }] })], { emojis }));
            expect(text).toContain("-# 1 signed up");
        });

        it("changes the hash with the emojis, so a later upload redraws the message", () => {
            const events = [raid("a", "2026-10-17T20:00:00")];
            expect(payloadHash(build(events, { emojis }), "en")).not.toBe(payloadHash(build(events, { emojis: {} }), "en"));
        });
    });

    describe("footer and hash", () => {
        it("keeps a category overview's hash of before the server overview (else every overview would be redrawn)", () => {
            // fixed values, computed once with the code of origin/main c0537c47 - change them only on purpose
            const events = () => [
                raid("a", "2026-10-17T20:00:00", { signUps: Array.from({ length: 17 }, (_, i) => ({ userId: `u${i}` })) }),
                raid("b", "2026-10-21T20:00:00", { size: 10, signUps: [{ userId: "x" }] }),
                raid("c", "2026-10-30T20:00:00", { leaderId: "" }),
                raid("gone", "2026-10-18T20:00:00", { status: "cancelled" }),
            ];
            expect(payloadHash(build(events(), { emojis: {} }), "en")).toBe("dd9cd623b8c482ff");
            expect(payloadHash(build(events(), { emojis: {}, lang: "de" }), "de")).toBe("942c4481db911734");
        });

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

    describe("the week strip as a picture (design D, a test)", () => {
        const events = () => [
            raid("a", "2026-10-17T20:00:00", { instanceIds: ["kara"], size: 10 }),
            raid("b", "2026-10-22T20:00:00", { instanceIds: ["ssc"] }),
        ];

        it("puts each ID's picture above its raids in place of the title line, and hands the SVGs along", () => {
            const payload = build(events(), { weekStrip: true });
            const galleries = nodes(payload).filter((n) => n.type === 12);
            expect(galleries).toHaveLength(2);
            expect(galleries[0].items[0].media.url).toBe("attachment://raid-id-1.png");
            expect(galleries[1].items[0].media.url).toBe("attachment://raid-id-2.png");
            expect(galleries[0].items[0].description).toContain("This ID · Wed 14.10. – Tue 20.10.");
            expect(galleries[0].items[0].description).toContain("KARA 0/10");
            expect(payload.images.map((i) => i.name)).toEqual(["raid-id-1.png", "raid-id-2.png"]);
            expect(payload.images[0].svg).toContain(">KARA<");
            expect(payload.images[1].svg).toContain(">NEXT ID<");
            const text = texts(payload);
            // the title lines are in the picture now; the raid lines stay
            expect(text).not.toContain("**This ID**");
            expect(text).toContain("<#ch-a> · led by <@lead-a>");
            expect(text).toContain("<#ch-b>");
        });

        it("is the text form without the switch: no gallery, no images, the same hash as before", () => {
            const off = build(events());
            expect(nodes(off).some((n) => n.type === 12)).toBe(false);
            expect(off.images).toBeUndefined();
            expect(payloadHash(off, "en")).toBe(payloadHash(build(events(), { weekStrip: false }), "en"));
            expect(payloadHash(off, "en")).not.toBe(payloadHash(build(events(), { weekStrip: true }), "en"));
        });

        it("keeps the picture and the hash when only the footer time changes, changes the hash when only the picture does", () => {
            const a = build(events(), { weekStrip: true });
            const b = build(events(), { weekStrip: true, lastChange: 1760000000 });
            expect(b.images).toEqual(a.images);
            expect(payloadHash(a, "en")).toBe(payloadHash(build(events(), { weekStrip: true }), "en"));
            // same components, another picture (today's mark moved on): another hash
            const c = { ...a, images: [{ ...a.images[0], svg: `${a.images[0].svg} ` }, a.images[1]] };
            expect(payloadHash(c, "en")).not.toBe(payloadHash(a, "en"));
            // the next day the running ID's picture changes - and with it the hash
            const tomorrow = build(events(), { weekStrip: true, now: NOW + 86400000 });
            expect(tomorrow.images[0].svg).not.toBe(a.images[0].svg);
            expect(payloadHash(tomorrow, "en")).not.toBe(payloadHash(a, "en"));
        });

        it("stays within Discord's 40 components with pictures on", () => {
            const many = Array.from({ length: 30 }, (_, i) => raid(`r${i}`, `2026-10-${String(15 + (i % 14)).padStart(2, "0")}T20:00:00`));
            const payload = build(many, { weekStrip: true });
            expect(nodes(payload).length).toBeLessThanOrEqual(MAX_COMPONENTS);
            expect(payload.images.length).toBeLessThanOrEqual(MAX_IDS);
        });
    });

    describe("the overview of a whole server (server: true)", () => {
        const events = () => [
            raid("a", "2026-10-17T20:00:00", { categoryName: "⚔️ 10er" }),
            raid("b", "2026-10-18T20:00:00", { categoryName: "🔥 40er", leaderId: "" }),
            raid("c", "2026-10-19T20:00:00", { categoryName: "", channelId: "" }),
        ];

        it("is headed Raids and names each raid's category first on its second line", () => {
            const text = texts(build(events(), { categoryName: "", server: true }));
            expect(text).toContain("## Raids");
            expect(text).not.toContain("## PUG Raids");
            expect(text).toContain("10er · <#ch-a> · led by <@lead-a>");
            expect(text).toContain("40er · <#ch-b>");
            expect(text).not.toContain("40er · <#ch-b> · led by");
            // a raid without category or channel just keeps its leader
            expect(text).toContain("led by <@lead-c>");
            expect(text).not.toContain("⚔️");
        });

        it("writes the heading in German", () => {
            expect(texts(build(events(), { categoryName: "", server: true, lang: "de" }))).toContain("## Raids");
        });

        it("leaves the overview of a category exactly as it was", () => {
            const plain = build(events());
            const off = build(events(), { server: false });
            expect(JSON.stringify(off)).toBe(JSON.stringify(plain));
            expect(payloadHash(off, "en")).toBe(payloadHash(plain, "en"));
            const text = texts(plain);
            expect(text).toContain("## PUG Raids");
            expect(text).toContain("\n<#ch-a> · led by <@lead-a>");
            expect(text).not.toContain("10er");
            expect(payloadHash(build(events(), { server: true }), "en")).not.toBe(payloadHash(plain, "en"));
        });
    });
});

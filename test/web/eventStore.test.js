// In-memory fs, so the store never touches the repo's disk.
jest.mock("fs", () => {
    const store = new Map();
    return {
        __store: store,
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn((p, data) => store.set(p, String(data))),
        readFileSync: jest.fn((p) => {
            if (!store.has(p)) {
                const e = new Error("ENOENT");
                e.code = "ENOENT";
                throw e;
            }
            return store.get(p);
        }),
    };
});

const fs = require("fs");
const {
    listEvents, getEvent, createEvent, updateEvent, setEventMessage, deleteEvent, normalizePlan, isOwnEventId,
} = require("../../src/web/eventStore");

const base = (over = {}) => ({
    guildId: "g1", channelId: "c1", channelName: "kara-do", categoryId: "cat1", categoryName: "Raids",
    title: "Kara Donnerstag", startTime: 2000000000, leaderId: "u1", ...over,
});

describe("web/eventStore", () => {
    beforeEach(() => fs.__store.clear());

    it("creates an event with an own, recognisable id and the source eventhelper", () => {
        const { event, error } = createEvent(base({ instanceIds: ["kara"] }));
        expect(error).toBeUndefined();
        expect(isOwnEventId(event.id)).toBe(true);
        expect(isOwnEventId("1234567890")).toBe(false);
        expect(event).toMatchObject({
            source: "eventhelper", guildId: "g1", channelId: "c1", categoryId: "cat1", title: "Kara Donnerstag",
            versionId: "tbc", instanceIds: ["kara"], size: 10,
            composition: { tank: 2, healer: 3, melee: 0, ranged: 0 },
            signupDeadline: 0, fairness: false, wishes: false, setup: null, message: null,
        });
        expect(getEvent(event.id)).toEqual(event);
    });

    it("fills size and tanks/healers from the rule set", () => {
        expect(normalizePlan({}).value).toEqual({
            versionId: "tbc", instanceIds: [], size: 25, composition: { tank: 3, healer: 6, melee: 0, ranged: 0 },
            compositionMax: { melee: null, ranged: null }, requiredBuffs: [],
        });
        // the biggest instance of the night decides the size
        expect(normalizePlan({ instanceIds: ["kara", "gruul"] }).value.size).toBe(25);
        // a given composition wins
        expect(normalizePlan({ instanceIds: ["kara"], composition: { tank: 1, healer: 2 } }).value.composition)
            .toEqual({ tank: 1, healer: 2, melee: 0, ranged: 0 });
    });

    it("refuses what the rule set does not know or what does not fit", () => {
        expect(normalizePlan({ versionId: "wotlk" }).error).toMatch(/Spielversion/);
        expect(normalizePlan({ instanceIds: ["naxx-nope"] }).error).toMatch(/Unbekannte Instanz/);
        expect(normalizePlan({ versionId: "classic", instanceIds: ["kara"] }).error).toMatch(/gehört nicht/);
        expect(normalizePlan({ size: 50 }).error).toMatch(/40/);
        expect(normalizePlan({ size: "x" }).error).toMatch(/Raidgröße/);
        expect(normalizePlan({ size: 10, composition: { tank: 5, healer: 6 } }).error).toMatch(/größer als der Raid/);
        expect(normalizePlan({ composition: { tank: -1 } }).error).toMatch(/ab 0/);
    });

    // #261: melee/ranged as ranges, the required buffs
    it("keeps melee/ranged ranges as minimum plus optional maximum", () => {
        const plan = normalizePlan({ size: 25, composition: { tank: 3, healer: 6, melee: { min: 6, max: 8 }, ranged: 5 } }).value;
        expect(plan.composition).toEqual({ tank: 3, healer: 6, melee: 6, ranged: 5 });
        expect(plan.compositionMax).toEqual({ melee: 8, ranged: null });
        // the maximum can also come on its own
        expect(normalizePlan({ size: 25, composition: { ranged: 4 }, compositionMax: { ranged: 10 } }).value.compositionMax.ranged).toBe(10);
    });

    it("checks the ranges and the sum of the minimums against the size", () => {
        expect(normalizePlan({ size: 25, composition: { melee: { min: 8, max: 6 } } }).error).toMatch(/Nahkampf: Minimum ist größer als Maximum/);
        expect(normalizePlan({ size: 10, composition: { tank: 2, healer: 3, ranged: { min: 2, max: 12 } } }).error).toMatch(/Fernkampf: Maximum ist größer als die Größe 10/);
        // the minimums count: 3 + 6 + 10 + 7 = 26 > 25
        expect(normalizePlan({ size: 25, composition: { tank: 3, healer: 6, melee: { min: 10, max: 12 }, ranged: { min: 7, max: null } } }).error)
            .toMatch(/Zusammensetzung \(26\) ist größer als der Raid \(25\)/);
        // the maxima may add up to more than the size: they are upper bounds, not seats
        expect(normalizePlan({ size: 25, composition: { tank: 3, healer: 6, melee: { min: 6, max: 16 }, ranged: { min: 6, max: 16 } } }).error).toBeUndefined();
    });

    it("takes required buffs only from the version's rule set", () => {
        expect(normalizePlan({ requiredBuffs: ["windfury", "kings", "windfury"] }).value.requiredBuffs).toEqual(["windfury", "kings"]);
        expect(normalizePlan({ requiredBuffs: ["heroism"] }).error).toMatch(/Buff „heroism“ gibt es in/);
        // Totem of Wrath does not exist in Classic
        expect(normalizePlan({ versionId: "classic", requiredBuffs: ["totemOfWrath"] }).error).toMatch(/totemOfWrath/);
    });

    it("stores ranges, buffs and the raid template on the event and keeps the maxima on unrelated edits", () => {
        const { event } = createEvent(base({
            instanceIds: ["ssc"], size: 25, composition: { tank: 3, healer: 6, melee: { min: 6, max: 8 } },
            requiredBuffs: ["windfury"], raidTemplateId: "tpl-1",
        }));
        expect(event).toMatchObject({ compositionMax: { melee: 8, ranged: null }, requiredBuffs: ["windfury"], raidTemplateId: "tpl-1" });
        expect(updateEvent(event.id, { size: 20 }).event.compositionMax).toEqual({ melee: 8, ranged: null });
        // a new composition brings its own ranges
        expect(updateEvent(event.id, { composition: { tank: 2, healer: 5 } }).event.compositionMax).toEqual({ melee: null, ranged: null });
        expect(updateEvent(event.id, { requiredBuffs: ["nope"] }).error).toMatch(/nope/);
    });

    it("refuses an event without title, channel, date or with a deadline after the start", () => {
        expect(createEvent(base({ title: "" })).error).toMatch(/Titel/);
        expect(createEvent(base({ channelId: "" })).error).toMatch(/Channel/);
        expect(createEvent(base({ guildId: "" })).error).toMatch(/Server/);
        expect(createEvent(base({ startTime: 0 })).error).toMatch(/Termin/);
        expect(createEvent(base({ signupDeadline: 2000000001 })).error).toMatch(/Anmeldeschluss/);
        expect(listEvents("g1")).toEqual([]);
    });

    it("lists a guild's events newest first, bounded by start time", () => {
        const a = createEvent(base({ title: "A", startTime: 1000 })).event;
        const b = createEvent(base({ title: "B", startTime: 3000 })).event;
        createEvent(base({ title: "Other guild", guildId: "g2" }));
        expect(listEvents("g1").map((e) => e.id)).toEqual([b.id, a.id]);
        expect(listEvents("g1", { sinceSeconds: 2000 }).map((e) => e.title)).toEqual(["B"]);
        expect(listEvents("g1", { untilSeconds: 2000 }).map((e) => e.title)).toEqual(["A"]);
        expect(listEvents("").length).toBe(3);
    });

    it("updates fields and re-validates the plan", () => {
        const { event } = createEvent(base({ instanceIds: ["kara"] }));
        const { event: next } = updateEvent(event.id, { title: "Kara Freitag", size: 10, composition: { tank: 2, healer: 2 } });
        expect(next).toMatchObject({ title: "Kara Freitag", composition: { tank: 2, healer: 2, melee: 0, ranged: 0 } });
        expect(updateEvent(event.id, { size: 99 }).error).toMatch(/40/);
        expect(updateEvent("eh-missing", { title: "x" }).error).toMatch(/nicht gefunden/);
    });

    it("remembers the bot's message and deletes an event", () => {
        const { event } = createEvent(base());
        expect(setEventMessage(event.id, { channelId: "c1", messageId: "m1" }).message).toEqual({ channelId: "c1", messageId: "m1" });
        expect(setEventMessage(event.id, null).message).toBeNull();
        expect(setEventMessage("eh-missing", { messageId: "m" })).toBeNull();
        expect(deleteEvent(event.id)).toBe(true);
        expect(deleteEvent(event.id)).toBe(false);
        expect(getEvent(event.id)).toBeNull();
    });
});

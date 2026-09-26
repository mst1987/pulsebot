// In-memory fs, so the store never touches the repo's disk.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const {
    listEvents, getEvent, createEvent, updateEvent, setEventMessage, deleteEvent, normalizePlan, isOwnEventId, setEventSetupPost,
    setEventSetupPingText, setEventDiscordEvent, eventEndTime, setEventExtraRole,
} = require("../../src/stores/eventStore");

const base = (over = {}) => ({
    guildId: "g1", channelId: "c1", channelName: "kara-do", categoryId: "cat1", categoryName: "Raids",
    title: "Kara Donnerstag", startTime: 2000000000, leaderId: "u1", ...over,
});

describe("stores/eventStore", () => {
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

    it("merges the posted-setup record and clears it with null (#290)", () => {
        const { event } = createEvent(base());
        expect(event.setupPost).toBeNull();
        setEventSetupPost(event.id, { channelId: "c1", messageId: "m1", version: 1 });
        expect(setEventSetupPost(event.id, { version: 2, told: { u1: "g1/Priest-Holy/healer" } }).setupPost)
            .toEqual({ channelId: "c1", messageId: "m1", version: 2, told: { u1: "g1/Priest-Holy/healer" } });
        expect(getEvent(event.id).setupPost.messageId).toBe("m1");
        expect(setEventSetupPost(event.id, null).setupPost).toBeNull();
        expect(setEventSetupPost("eh-nope", { version: 1 })).toBeNull();
    });

    it("marks a raider as an extra tank / healer, keeps the marks apart from the setup, and takes them away again", () => {
        const { event } = createEvent(base());
        expect(event.extraRoles).toEqual({});
        expect(setEventExtraRole(event.id, "u9", "tank", true).extraRoles).toEqual({ u9: ["tank"] });
        expect(setEventExtraRole(event.id, "u9", "healer", true).extraRoles).toEqual({ u9: ["tank", "healer"] });
        expect(setEventExtraRole(event.id, "u9", "tank", true).extraRoles.u9).toEqual(["tank", "healer"]);
        expect(getEvent(event.id).extraRoles).toEqual({ u9: ["tank", "healer"] });
        expect(setEventExtraRole(event.id, "u9", "tank", false).extraRoles).toEqual({ u9: ["healer"] });
        expect(setEventExtraRole(event.id, "u9", "healer", false).extraRoles).toEqual({});
        // only tank and healer, only for a known event
        expect(setEventExtraRole(event.id, "u9", "melee", true)).toBeNull();
        expect(setEventExtraRole("eh-nope", "u9", "tank", true)).toBeNull();
    });

    it("stores the ping text, empty by default, trimmed to 300 characters (#354's follow-up)", () => {
        const { event } = createEvent(base());
        expect(event.setupPingText).toBe("");
        expect(setEventSetupPingText(event.id, "  Kommt alle!  ").setupPingText).toBe("Kommt alle!");
        expect(getEvent(event.id).setupPingText).toBe("Kommt alle!");
        expect(setEventSetupPingText(event.id, "x".repeat(400)).setupPingText).toHaveLength(300);
        expect(setEventSetupPingText("eh-nope", "x")).toBeNull();
    });

    it("fills size and tanks/healers from the rule set", () => {
        expect(normalizePlan({}).value).toEqual({
            versionId: "tbc", instanceIds: [], size: 25, composition: { tank: 3, healer: 6, melee: 0, ranged: 0 },
            compositionMax: { melee: null, ranged: null }, requiredBuffs: [], durationMinutes: 180,
            // #307: no own look — the rule set of the instances decides.
            color: "", image: { mode: "thumbnail", url: "" },
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

    // #305: how long the raid takes, and where it meets
    it("takes a duration between 30 and 600 minutes and refuses anything else", () => {
        expect(normalizePlan({ durationMinutes: 300 }).value.durationMinutes).toBe(300);
        expect(normalizePlan({ durationMinutes: 30 }).value.durationMinutes).toBe(30);
        expect(normalizePlan({ durationMinutes: 600 }).value.durationMinutes).toBe(600);
        // empty means "not given" — the default stands
        expect(normalizePlan({ durationMinutes: "" }).value.durationMinutes).toBe(180);
        expect(normalizePlan({ durationMinutes: 29 }).error).toMatch(/Dauer/);
        expect(normalizePlan({ durationMinutes: 601 }).error).toMatch(/Dauer/);
        expect(normalizePlan({ durationMinutes: "lang" }).error).toMatch(/Dauer/);
    });

    it("keeps the voice channel and reports the end of the raid", () => {
        const { event } = createEvent({
            guildId: "g1", channelId: "c1", title: "SSC", startTime: 2000000000, voiceChannelId: "v1", durationMinutes: 240,
        });
        expect(event).toMatchObject({ voiceChannelId: "v1", durationMinutes: 240 });
        expect(eventEndTime(event)).toBe(2000000000 + 240 * 60);
        // an event stored before #305 reads as the default
        expect(eventEndTime({ startTime: 2000000000 })).toBe(2000000000 + 180 * 60);
        expect(eventEndTime({})).toBe(0);
        const changed = updateEvent(event.id, { voiceChannelId: "v2", durationMinutes: 90 });
        expect(changed.event).toMatchObject({ voiceChannelId: "v2", durationMinutes: 90 });
        expect(updateEvent(event.id, { durationMinutes: 5 }).error).toMatch(/Dauer/);
    });

    it("keeps the Discord event record apart from the plan (#305)", () => {
        const { event } = createEvent({ guildId: "g1", channelId: "c1", title: "SSC", startTime: 2000000000 });
        expect(event.discordEvent).toBeNull();
        expect(setEventDiscordEvent(event.id, { id: "d1", guildId: "g1" }).discordEvent).toEqual({ id: "d1", guildId: "g1" });
        // merged, not replaced
        expect(setEventDiscordEvent(event.id, { error: "x" }).discordEvent).toEqual({ id: "d1", guildId: "g1", error: "x" });
        expect(setEventDiscordEvent(event.id, null).discordEvent).toBeNull();
        expect(setEventDiscordEvent("eh-nope", { id: "d1" })).toBeNull();
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
        // with the hash of what it shows (#303: the sweep redraws an outdated message)
        expect(setEventMessage(event.id, { channelId: "c1", messageId: "m1", hash: "abc" }).message).toEqual({ channelId: "c1", messageId: "m1", hash: "abc" });
        expect(setEventMessage(event.id, null).message).toBeNull();
        expect(setEventMessage("eh-missing", { messageId: "m" })).toBeNull();
        expect(deleteEvent(event.id)).toBe(true);
        expect(deleteEvent(event.id)).toBe(false);
        expect(getEvent(event.id)).toBeNull();
    });

    it("stores a setup proposal only as a draft and never over an approved setup", () => {
        const { saveSetupDraft } = require("../../src/stores/eventStore");
        const { event } = createEvent(base());
        const proposal = { version: 1, groups: [{ index: 1, slots: [] }], bench: [], status: "approved", events: [{ eventId: "x" }] };
        const saved = saveSetupDraft(event.id, proposal, { now: 1234 });
        // stored in the setup editor's shape (#263): an automatic draft, version 1, nothing approved
        expect(saved.event.setup).toMatchObject({
            groups: [{ index: 1, slots: [] }], bench: [], status: "draft", origin: "auto", version: 1, proposalVersion: 1,
            approved: null, changedSinceApproval: false, createdBy: "auto", createdAt: 1234, updatedAt: 1234,
        });
        expect(saved.event.setup.events).toBeUndefined();
        expect(getEvent(event.id).setup.status).toBe("draft");
        // a second automatic draft counts the version up
        expect(saveSetupDraft(event.id, proposal, { now: 1235 }).event.setup.version).toBe(2);
        expect(saveSetupDraft("eh-missing", proposal)).toMatchObject({ code: "not_found" });

        // an approved setup (#263) stays untouched
        const raw = JSON.parse(fs.__store.get([...fs.__store.keys()][0]));
        raw.events[0].setup = { status: "approved", groups: [] };
        fs.__store.set([...fs.__store.keys()][0], JSON.stringify(raw));
        expect(saveSetupDraft(event.id, proposal)).toMatchObject({ code: "approved" });
        expect(getEvent(event.id).setup).toEqual({ status: "approved", groups: [] });

        // …and so does a draft changed after an approval: raiders still see that approval
        raw.events[0].setup = { status: "draft", changedSinceApproval: true, groups: [], approved: { version: 1, groups: [], bench: [] } };
        fs.__store.set([...fs.__store.keys()][0], JSON.stringify(raw));
        expect(saveSetupDraft(event.id, proposal)).toMatchObject({ code: "approved" });
    });
});

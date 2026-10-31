// Raid groups (#811, src/services/events/raidGroup.js + the setup editor): an
// overbooked own event gets a further raid at the same time; the raiders stay
// signed up at the first raid, the orga splits them in one editor — one shared
// pool, one seat per person across the group, a proposal over every raid, a
// setup (and approval) per raid — and a further raid without an approved setup
// can be dissolved again, its raiders falling back into the pool.
jest.mock("../../../src/stores/roster/raiderProfileStore", () => ({ listProfiles: () => [], firstCharacter: () => null, getProfile: () => null }));
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: () => ({}), getRaidTemplate: () => null }));
jest.mock("../../../src/stores/roster/rosterStore", () => ({ rosterForCategory: () => null }));
jest.mock("../../../src/services/characters/rosterAttendance", () => ({ buildAttendanceContext: () => ({}), attendanceFor: () => ({ pct: null }) }));
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/discordMock").withClientHelpers({ getClient: jest.fn(), sendDirectMessage: jest.fn() }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 7 }));

const { tempStoreFile } = require("../../helpers/tempStore");
const eventStore = require("../../../src/stores/events/eventStore");
const signupStore = require("../../../src/stores/events/signupStore");
const leaderFlagsStore = require("../../../src/stores/roster/leaderFlagsStore");
const raidGroup = require("../../../src/services/events/raidGroup");
const editor = require("../../../src/services/setup/setupEditor");
const { collectSetupInput } = require("../../../src/services/setup/setupInput");
const { isRaidSibling, isRaidPrimary, signupEventIdOf } = require("../../../src/utils/raidGroup");

const START = 4000000000; // far ahead: a raid group is only added before the start
const NOW = 3900000000 * 1000;

// 14 raiders for a 10-man: 2 tanks, 4 healers, 8 dps
const ROSTER = [
    ["t1", "Warrior-Protection"], ["t2", "Paladin-Protection"],
    ["h1", "Priest-Holy"], ["h2", "Paladin-Holy"], ["h3", "Druid-Restoration"], ["h4", "Shaman-Restoration"],
    ["d1", "Mage-Fire"], ["d2", "Rogue-Combat"], ["d3", "Hunter-BeastMastery"], ["d4", "Warlock-Destruction"],
    ["d5", "Mage-Frost"], ["d6", "Warrior-Fury"], ["d7", "Rogue-Assassination"], ["d8", "Priest-Shadow"],
];

let primary;

beforeEach(() => {
    eventStore.useFile(tempStoreFile("events.json"));
    signupStore.useFile(tempStoreFile("signups.json"));
    primary = eventStore.createEvent({
        guildId: "g1", channelId: "c1", categoryId: "cat", title: "Zul'Aman", startTime: START, versionId: "tbc",
        size: 10, composition: { tank: 1, healer: 2, melee: 0, ranged: 0 }, requiredBuffs: [], durationMinutes: 180,
        raidTemplateId: "tpl-za", signupDeadline: START - 3600,
    }).event;
    for (const [id, spec] of ROSTER) {
        signupStore.saveSignup(primary.id, id, { character: id.toUpperCase(), spec, status: "signed" }, { versionId: "tbc" });
    }
});

const placed = (setup) => (setup ? setup.groups.flatMap((g) => g.slots.map((s) => s.userId)) : []);
const add = (title = "") => raidGroup.addRaid(primary.id, { title, user: { id: "orga", name: "Orga" }, now: NOW });

describe("adding a further raid", () => {
    it("copies the evening (start, duration, category, version, template, size, composition, channel), titles it \"<Titel> 2\" and links both", () => {
        const out = add();
        expect(out.error).toBeUndefined();
        const sibling = out.event;
        expect(sibling).toMatchObject({
            title: "Zul'Aman 2", startTime: START, durationMinutes: 180, categoryId: "cat", versionId: "tbc", raidTemplateId: "tpl-za",
            size: 10, channelId: "c1", signupDeadline: START - 3600, raidGroupId: primary.id, raidGroupIndex: 2, message: null,
        });
        expect(sibling.composition).toMatchObject({ tank: 1, healer: 2 });
        const head = eventStore.getEvent(primary.id);
        expect(head).toMatchObject({ raidGroupId: primary.id, raidGroupIndex: 1 });
        expect(isRaidPrimary(head)).toBe(true);
        expect(isRaidSibling(sibling)).toBe(true);
        expect(signupEventIdOf(sibling)).toBe(primary.id);
        expect(head.log.map((l) => l.action)).toContain("raidAdd");
    });

    it("takes an edited title and numbers a third raid on; the group's summary counts every place", () => {
        add();
        const third = add("ZA Gruppe C").event;
        expect(third).toMatchObject({ title: "ZA Gruppe C", raidGroupIndex: 3 });
        const summary = raidGroup.groupSummary(third);
        expect(summary).toMatchObject({ id: primary.id, primaryId: primary.id, count: 3, places: 30 });
        expect(summary.raids.map((r) => [r.title, r.index])).toEqual([["Zul'Aman", 1], ["Zul'Aman 2", 2], ["ZA Gruppe C", 3]]);
        expect(raidGroup.groupPlaces(primary)).toBe(10); // a stale record without the group: its own size
        expect(raidGroup.groupPlaces(eventStore.getEvent(primary.id))).toBe(30);
    });

    it("keeps the further raids out of every plain event list (one night, one signup) and hands them out when asked", () => {
        const sibling = add().event;
        expect(eventStore.listEvents("g1").map((e) => e.id)).toEqual([primary.id]);
        expect(eventStore.listEvents("g1", { siblings: true }).map((e) => e.id).sort()).toEqual([primary.id, sibling.id].sort());
    });

    it("refuses a started or cancelled raid and a Raid-Helper id", () => {
        expect(raidGroup.addRaid(primary.id, { now: (START + 60) * 1000 }).code).toBe("started");
        eventStore.setEventState(primary.id, { status: "cancelled" });
        expect(raidGroup.addRaid(primary.id, { now: NOW }).code).toBe("cancelled");
        expect(raidGroup.addRaid("123456").code).toBe("raidhelper");
    });

    it("asked on a further raid, adds to the same group", () => {
        const second = add().event;
        const third = raidGroup.addRaid(second.id, { now: NOW }).event;
        expect(third).toMatchObject({ raidGroupId: primary.id, raidGroupIndex: 3, title: "Zul'Aman 3" });
    });
});

describe("adding several raids at once (#1035)", () => {
    const addMany = (count, extra = {}) => raidGroup.addRaids(primary.id, { count, user: { id: "orga", name: "Orga" }, now: NOW, ...extra });

    it("count 4 makes four further raids numbered on, with one log entry on the first raid", () => {
        const out = addMany(4);
        expect(out.error).toBeUndefined();
        expect(out.events.map((e) => [e.title, e.raidGroupIndex])).toEqual([["Zul'Aman 2", 2], ["Zul'Aman 3", 3], ["Zul'Aman 4", 4], ["Zul'Aman 5", 5]]);
        expect(out.events.every((e) => e.raidGroupId === primary.id && e.size === 10 && e.startTime === START)).toBe(true);
        const head = eventStore.getEvent(primary.id);
        expect(head).toMatchObject({ raidGroupId: primary.id, raidGroupIndex: 1 });
        const adds = head.log.filter((l) => l.action === "raidAdd");
        expect(adds).toHaveLength(1);
        expect(adds[0].detail).toMatch(/^4 Raids angelegt: Zul'Aman 2, Zul'Aman 3, Zul'Aman 4, Zul'Aman 5$/);
        expect(raidGroup.groupSummary(head)).toMatchObject({ count: 5, places: 50 });
    });

    it("numbers on after the raids the group already has and takes given titles", () => {
        add();
        const out = addMany(2, { titles: ["ZA C"] });
        expect(out.events.map((e) => [e.title, e.raidGroupIndex])).toEqual([["ZA C", 3], ["Zul'Aman 4", 4]]);
    });

    it("count 1 is the plain further raid", () => {
        const out = addMany(1);
        expect(out.events.map((e) => e.title)).toEqual(["Zul'Aman 2"]);
        expect(eventStore.getEvent(primary.id).log.find((l) => l.action === "raidAdd").detail).toBe("Weiterer Raid angelegt: Zul'Aman 2");
    });

    it("keeps the limit of 8 raids: more is refused as a whole (400 too_many), nothing made", () => {
        expect(addMany(8)).toMatchObject({ status: 400, code: "too_many" });
        expect(raidGroup.groupEvents(eventStore.getEvent(primary.id))).toHaveLength(1);
        expect(addMany(7).events).toHaveLength(7);
        expect(addMany(1).code).toBe("too_many");
    });

    it("refuses a bad count, a started or cancelled raid and a Raid-Helper id as before", () => {
        expect(addMany(0).code).toBe("invalid");
        expect(addMany(2.5).code).toBe("invalid");
        expect(addMany(3, { now: (START + 60) * 1000 }).code).toBe("started");
        expect(raidGroup.addRaids("123456", { count: 3 }).code).toBe("raidhelper");
        eventStore.setEventState(primary.id, { status: "cancelled" });
        expect(addMany(3).code).toBe("cancelled");
        expect(raidGroup.groupEvents(eventStore.getEvent(primary.id))).toHaveLength(1);
    });
});

describe("the suggested number of raids (#1035)", () => {
    it("50 signups for a 10-man: 5 raids in total", () => {
        expect(raidGroup.suggestedRaidTotal({ active: 50, size: 10 })).toBe(5);
    });
    it("rounds up, stops at 8 raids and is 0 without signups or size", () => {
        expect(raidGroup.suggestedRaidTotal({ active: 41, size: 10 })).toBe(5);
        expect(raidGroup.suggestedRaidTotal({ active: 200, size: 10 })).toBe(8);
        expect(raidGroup.suggestedRaidTotal({ active: 9, size: 10 })).toBe(1);
        expect(raidGroup.suggestedRaidTotal({ active: 0, size: 10 })).toBe(0);
        expect(raidGroup.suggestedRaidTotal({ active: 30, size: 0 })).toBe(0);
    });
    it("suggests a split only when every raid would be filled to 70 % (a 25-man)", () => {
        expect(raidGroup.SPLIT_MIN_FILL).toBe(0.7);
        expect(raidGroup.suggestedRaidTotal({ active: 25, size: 25 })).toBe(1);
        expect(raidGroup.suggestedRaidTotal({ active: 26, size: 25 })).toBe(1);
        expect(raidGroup.suggestedRaidTotal({ active: 34, size: 25 })).toBe(1);
        expect(raidGroup.suggestedRaidTotal({ active: 35, size: 25 })).toBe(2);
        expect(raidGroup.suggestedRaidTotal({ active: 52, size: 25 })).toBe(2);
        expect(raidGroup.suggestedRaidTotal({ active: 53, size: 25 })).toBe(3);
        expect(raidGroup.suggestedRaidTotal({ active: 1000, size: 25 })).toBe(8);
    });
    it("the editor counts who is signed up — maybe and bench too, not who is absent", () => {
        for (let i = 0; i < 12; i += 1) signupStore.saveSignup(primary.id, `m${i}`, { character: `M${i}`, spec: "Mage-Fire", status: i < 4 ? "tentative" : "bench" }, { versionId: "tbc" });
        for (let i = 0; i < 5; i += 1) signupStore.saveSignup(primary.id, `a${i}`, { status: "absence" }, { versionId: "tbc" });
        const signups = signupStore.listSignups(primary.id);
        const view = editor.editorView(eventStore.getEvent(primary.id), { canWrite: true, signups });
        expect(view.signupCount).toBe(26);
        expect(view.suggestedTotal).toBe(3);
    });
});

describe("the shared signup and pool", () => {
    it("gives every raid of the group the first raid's signups — the further raid has none of its own", () => {
        const sibling = add().event;
        expect(signupStore.listSignups(sibling.id)).toEqual([]);
        const input = collectSetupInput([sibling.id], { now: NOW });
        expect(input.signups).toHaveLength(ROSTER.length);
        expect(new Set(input.signups.map((s) => s.eventId))).toEqual(new Set([sibling.id]));
    });

    it("shows one shared pool: the signups minus everybody placed in any raid of the group", () => {
        const sibling = add().event;
        const saved = editor.saveEventSetup(primary.id, { groups: [{ index: 1, slots: [{ userId: "t1", spec: "Warrior-Protection" }, { userId: "h1", spec: "Priest-Holy" }] }], bench: [] }, { now: NOW });
        expect(saved.error).toBeUndefined();
        const view = editor.editorView(eventStore.getEvent(sibling.id), { canWrite: true, signups: signupStore.listSignups(primary.id), blank: true });
        const pool = view.setup.pool.map((p) => p.userId);
        expect(pool).not.toContain("t1");
        expect(pool).not.toContain("h1");
        expect(pool).toHaveLength(ROSTER.length - 2);
        expect(view.placedElsewhere).toBe(2);
        expect(view.raidGroup.raids.map((r) => [r.index, r.placed])).toEqual([[1, 2], [2, 0]]);
    });
});

describe("one seat per person across the group", () => {
    it("refuses a lineup that places somebody who already stands in another raid (group or bench)", () => {
        const sibling = add().event;
        editor.saveEventSetup(primary.id, { groups: [{ index: 1, slots: [{ userId: "t1", spec: "Warrior-Protection" }] }], bench: [{ userId: "d8" }] }, { now: NOW });
        const twice = editor.saveEventSetup(sibling.id, { groups: [{ index: 1, slots: [{ userId: "t1", spec: "Warrior-Protection" }] }], bench: [] }, { now: NOW });
        expect(twice.code).toBe("taken");
        expect(twice.error).toMatch(/T1 steht schon in Zul'Aman/);
        const benched = editor.saveEventSetup(sibling.id, { groups: [], bench: [{ userId: "d8" }] }, { now: NOW });
        expect(benched.code).toBe("taken");
        expect(editor.saveEventSetup(sibling.id, { groups: [{ index: 1, slots: [{ userId: "t2", spec: "Paladin-Protection" }] }], bench: [] }, { now: NOW }).error).toBeUndefined();
    });

    it("moves a raider between the raids: out of the first, onto the other's first free place — and from the pool, as the named character", () => {
        const sibling = add().event;
        editor.saveEventSetup(primary.id, { groups: [{ index: 1, slots: [{ userId: "t1", spec: "Warrior-Protection" }, { userId: "h1", spec: "Priest-Holy" }] }], bench: [] }, { now: NOW });
        const moved = editor.moveToRaid(primary.id, { target: sibling.id, userId: "t1" }, { userId: "orga", now: NOW });
        expect(moved.error).toBeUndefined();
        expect(placed(eventStore.getEvent(primary.id).setup)).toEqual(["h1"]);
        expect(placed(eventStore.getEvent(sibling.id).setup)).toEqual(["t1"]);
        expect(moved.moved).toMatchObject({ userId: "t1", to: sibling.id, group: 1 });
        // out of the shared pool straight into the other raid
        const fromPool = editor.moveToRaid(primary.id, { target: sibling.id, userId: "d1" }, { userId: "orga", now: NOW });
        expect(fromPool.error).toBeUndefined();
        expect(placed(eventStore.getEvent(sibling.id).setup).sort()).toEqual(["d1", "t1"]);
        // somebody already standing in the target is no move
        expect(editor.moveToRaid(primary.id, { target: sibling.id, userId: "d1" }, { now: NOW }).code).toBe("invalid");
        // a target outside the group is refused
        const other = eventStore.createEvent({ guildId: "g1", channelId: "c2", title: "Kara", startTime: START, versionId: "tbc", size: 10 }).event;
        expect(editor.moveToRaid(primary.id, { target: other.id, userId: "d2" }, { now: NOW }).code).toBe("invalid");
    });

    it("a failed second save puts the raider back with the raid's leader choice (#1036)", () => {
        // the leader rule needs a lead flag on the server: d8 (signed up here) may lead Karazhan
        leaderFlagsStore.useFile(tempStoreFile("leaderFlags.json"));
        leaderFlagsStore.setLeads("d8", "tbc", ["kara"], { by: "orga" });
        const sibling = add().event;
        editor.saveEventSetup(sibling.id, { groups: [{ index: 1, slots: [{ userId: "t2", spec: "Paladin-Protection" }] }], bench: [] }, { now: NOW });
        editor.saveEventSetup(primary.id, { groups: [{ index: 1, slots: [{ userId: "t1", spec: "Warrior-Protection" }, { userId: "h1", spec: "Priest-Holy" }] }], bench: [], leaderUserId: "h1" }, { now: NOW });
        expect(eventStore.getEvent(primary.id).setup.leaderUserId).toBe("h1");
        // somebody else saves the other raid in between: its save fails on the version
        const real = eventStore.setEventSetup;
        let bumped = false;
        const spy = jest.spyOn(eventStore, "setEventSetup").mockImplementation((id, setup, opts) => {
            const out = real(id, setup, opts);
            if (id === primary.id && !bumped) {
                bumped = true;
                const other = eventStore.getEvent(sibling.id).setup;
                real(sibling.id, { ...other, version: other.version + 1 });
            }
            return out;
        });
        const moved = editor.moveToRaid(primary.id, { target: sibling.id, userId: "h1" }, { userId: "orga", now: NOW });
        spy.mockRestore();
        expect(moved.code).toBe("conflict");
        const back = eventStore.getEvent(primary.id).setup;
        expect(placed(back).sort()).toEqual(["h1", "t1"]);
        expect(back.leaderUserId).toBe("h1");
    });

    it("refuses a move into a full raid", () => {
        const sibling = add().event;
        const ten = ROSTER.slice(0, 10).map(([userId, spec]) => ({ userId, spec }));
        editor.saveEventSetup(sibling.id, { groups: [{ index: 1, slots: ten.slice(0, 5) }, { index: 2, slots: ten.slice(5) }], bench: [] }, { now: NOW });
        expect(editor.moveToRaid(primary.id, { target: sibling.id, userId: "d7" }, { now: NOW }).code).toBe("full");
    });
});

describe("the proposal over the group", () => {
    it("fills every raid at once, nobody twice, each raid with its own stored part", () => {
        const sibling = add().event;
        const out = editor.proposeEventSetup(primary.id, {}, { userId: "orga", now: NOW });
        expect(out.error).toBeUndefined();
        expect(out.others).toHaveLength(1);
        const a = placed(eventStore.getEvent(primary.id).setup);
        const b = placed(eventStore.getEvent(sibling.id).setup);
        expect(a.length + b.length).toBe(ROSTER.length);
        expect(a.filter((id) => b.includes(id))).toEqual([]);
        // one tank per raid: the proposal splits the scarce role over the raids
        const tanksIn = (ids) => ids.filter((id) => id.startsWith("t")).length;
        expect(tanksIn(a)).toBe(1);
        expect(tanksIn(b)).toBe(1);
        expect(eventStore.getEvent(sibling.id).setup).toMatchObject({ status: "draft", origin: "proposal" });
    });

    it("\"Freie Plätze füllen\" keeps who stands where in every raid", () => {
        const sibling = add().event;
        editor.saveEventSetup(sibling.id, { groups: [{ index: 1, slots: [{ userId: "t1", spec: "Warrior-Protection" }] }], bench: [] }, { now: NOW });
        editor.proposeEventSetup(primary.id, { keep: "placed" }, { now: NOW });
        expect(placed(eventStore.getEvent(sibling.id).setup)).toContain("t1");
        expect(placed(eventStore.getEvent(primary.id).setup)).not.toContain("t1");
    });

    it("approves per raid: one raid's approval leaves the other a draft", () => {
        const sibling = add().event;
        editor.proposeEventSetup(primary.id, {}, { now: NOW });
        const approved = editor.approveEventSetup(sibling.id, { userId: "orga", now: NOW });
        expect(approved.error).toBeUndefined();
        expect(eventStore.getEvent(sibling.id).setup.status).toBe("approved");
        expect(eventStore.getEvent(primary.id).setup.status).toBe("draft");
    });
});

describe("dissolving a further raid", () => {
    it("deletes it, its raiders fall back into the pool, and the last one gone ends the group", () => {
        const sibling = add().event;
        editor.saveEventSetup(sibling.id, { groups: [{ index: 1, slots: [{ userId: "t1", spec: "Warrior-Protection" }] }], bench: [] }, { now: NOW });
        const out = raidGroup.dissolveRaid(sibling.id, { user: { id: "orga" }, now: NOW });
        expect(out.error).toBeUndefined();
        expect(out.placed).toBe(1);
        expect(eventStore.getEvent(sibling.id)).toBeNull();
        const head = eventStore.getEvent(primary.id);
        expect(head.raidGroupId).toBe("");
        const pool = editor.editorView(head, { canWrite: true, signups: signupStore.listSignups(primary.id), blank: true }).setup.pool.map((p) => p.userId);
        expect(pool).toContain("t1");
    });

    it("closes up the numbers of the others", () => {
        const second = add().event;
        const third = add().event;
        raidGroup.dissolveRaid(second.id, { now: NOW });
        expect(eventStore.getEvent(third.id)).toMatchObject({ raidGroupId: primary.id, raidGroupIndex: 2 });
    });

    it("refuses the first raid and a further raid with an approved setup", () => {
        const sibling = add().event;
        expect(raidGroup.dissolveRaid(primary.id).code).toBe("primary");
        editor.saveEventSetup(sibling.id, { groups: [{ index: 1, slots: [{ userId: "t1", spec: "Warrior-Protection" }] }], bench: [] }, { now: NOW });
        editor.approveEventSetup(sibling.id, { now: NOW });
        expect(raidGroup.dissolveRaid(sibling.id).code).toBe("approved");
    });

    it("moving the first raid takes the further raids along", () => {
        const sibling = add().event;
        eventStore.updateEvent(primary.id, { startTime: START + 3600, signupDeadline: START });
        expect(raidGroup.followPrimary(eventStore.getEvent(primary.id))).toBe(1);
        expect(eventStore.getEvent(sibling.id)).toMatchObject({ startTime: START + 3600, signupDeadline: START });
    });
});

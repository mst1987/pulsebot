// The orga changes a raider's signup from the setup editor (#521): status,
// character and spec through submitSignup(byOrga, offProfile), one log entry,
// and the stored setup follows — a placed raider keeps the place, a raider who
// signed off leaves it. Stores run for real on an in-memory fs; Discord, the
// messages and the notes channel are mocks.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/discordMock").withClientHelpers({
    listAllChannels: jest.fn(() => []),
    resolveUserNames: jest.fn(async () => ({})),
    memberRoleIds: jest.fn(async () => []),
    getClient: jest.fn(() => null),
}));
jest.mock("../../../src/services/events/eventMessage", () => ({ refreshEventMessage: jest.fn(async () => null) }));
jest.mock("../../../src/services/talk/talkOverview", () => ({ scheduleOverviewSync: jest.fn() }));
jest.mock("../../../src/services/signups/signupNotes", () => ({ postSignupNote: jest.fn(async () => ({ posted: false })) }));
jest.mock("../../../src/services/characters/rosterAttendance", () => ({ buildAttendanceContext: () => ({}), attendanceFor: () => ({ pct: null }) }));
jest.mock("../../../src/stores/settingsStore",() => ({ getConfig: jest.fn(() => ({})), getRaidTemplate: () => null }));

const fs = require("fs");
const eventStore = require("../../../src/stores/eventStore");
const signupStore = require("../../../src/stores/signupStore");
const profiles = require("../../../src/stores/raiderProfileStore");
const signupService = require("../../../src/services/signups/signupService");
const setupEditor = require("../../../src/services/setup/setupEditor");
const { signupEditView, changeSignupFromSetup } = require("../../../src/services/setup/setupSignup");

const ORGA = { id: "900000000000000001", name: "Orga" };
const NOW = Date.now();
const uid = (n) => `80000000000000${String(n).padStart(4, "0")}`;

// ten raiders for a 10-man: 1 tank, 2 healers, 7 dps; SHAMAN plays enhancement (profile: only enhancement)
const ROSTER = [
    ["Tankwart", "Warrior-Protection"], ["Heilbert", "Priest-Holy"], ["Lichtbringer", "Paladin-Holy"],
    ["Donnerfaust", "Shaman-Enhancement"], ["Schleich", "Rogue-Combat"], ["Feuerfritz", "Mage-Fire"],
    ["Zerstoerer", "Warlock-Destruction"], ["Pfeilchen", "Hunter-BeastMastery"], ["Katzenauge", "Druid-Feral"],
    ["Klingentanz", "Warrior-Arms"],
];
const SHAMAN = uid(3);
const BENCHER = uid(20);
const NOPROFILE = uid(21);

let event;
function seed(over = {}) {
    const start = Math.floor(NOW / 1000) + 7 * 86400;
    const { event: created } = eventStore.createEvent({
        guildId: "g1", channelId: "c1", categoryId: "cat", title: "Kara", startTime: start, signupDeadline: start - 86400,
        instanceIds: ["kara"], size: 10, composition: { tank: 1, healer: 2, melee: 0, ranged: 0 }, ...over,
    });
    return created;
}

function signUp(userId, character, spec, status = "signed", { profile = true } = {}) {
    if (profile) profiles.addCharacter(userId, { name: character, className: spec.split("-")[0], specs: [{ key: spec }] });
    const saved = signupStore.saveSignup(event.id, userId, { character, spec, status });
    if (saved.error) throw new Error(saved.error);
}

const slotOf = (userId) => {
    const setup = eventStore.getEvent(event.id).setup;
    for (const g of setup.groups) {
        const s = g.slots.find((x) => x.userId === userId);
        if (s) return { group: g.index, place: s.pos || g.slots.indexOf(s) + 1, ...s };
    }
    return null;
};

beforeEach(() => {
    fs.__store.clear();
    jest.clearAllMocks();
    event = seed();
    ROSTER.forEach(([character, spec], i) => signUp(uid(i), character, spec));
    signUp(BENCHER, "Wartebank", "Mage-Arcane", "bench");
    signUp(NOPROFILE, "Ohneprofil", "Priest-Shadow", "signed", { profile: false });
    const proposed = setupEditor.proposeEventSetup(event.id, {}, { userId: ORGA.id, now: NOW });
    if (proposed.error) throw new Error(proposed.error);
});

describe("changeSignupFromSetup", () => {
    it("turns a bench signup into 'Dabei', logs it as the orga and keeps the setup in step", async () => {
        const result = await changeSignupFromSetup(event.id, BENCHER, { status: "signed", from: "Wartebank" }, { user: ORGA, now: NOW });
        expect(result.error).toBeUndefined();
        expect(signupStore.getSignup(event.id, BENCHER)).toMatchObject({ status: "signed", character: "Wartebank", spec: "Mage-Arcane" });
        const log = eventStore.getEvent(event.id).log.at(-1);
        expect(log).toMatchObject({ action: "signupEdit", by: ORGA.id, byName: "Orga" });
        expect(log.detail).toBe("Wartebank · Bank → Dabei");
        // still in "Angemeldet" (nobody is placed by a status), now as "Dabei"
        const pool = eventStore.getEvent(event.id).setup.pool;
        expect(pool.find((p) => p.userId === BENCHER)).toMatchObject({ status: "signed" });
    });

    it("gives a placed shaman a spec his profile lacks — same place, new spec and role, the profile untouched", async () => {
        const before = slotOf(SHAMAN);
        expect(before).toMatchObject({ spec: "Shaman-Enhancement", role: "melee" });
        const result = await changeSignupFromSetup(event.id, SHAMAN, { status: "signed", from: "Donnerfaust", character: "Donnerfaust", spec: "Shaman-Elemental" }, { user: ORGA, now: NOW });
        expect(result.error).toBeUndefined();
        expect(signupStore.getSignup(event.id, SHAMAN)).toMatchObject({ spec: "Shaman-Elemental", role: "ranged" });
        expect(slotOf(SHAMAN)).toMatchObject({ group: before.group, place: before.place, spec: "Shaman-Elemental", role: "ranged" });
        expect(profiles.getProfile(SHAMAN).characters[0].specs.map((s) => s.key)).toEqual(["Shaman-Enhancement"]);
        expect(eventStore.getEvent(event.id).log.at(-1).detail).toMatch(/Verstärkung → Elementar/);
    });

    it("leaves the spec check of a member's own signup as it was", async () => {
        const own = await signupService.submitSignup(event.id, SHAMAN, { character: "Donnerfaust", spec: "Shaman-Elemental", status: "signed" }, { now: NOW });
        expect(own.code).toBe("spec");
        // byOrga alone (the signup page of an orga member) does not take it either
        const orga = await signupService.submitSignup(event.id, SHAMAN, { character: "Donnerfaust", spec: "Shaman-Elemental", status: "signed" }, { byOrga: true, now: NOW });
        expect(orga.code).toBe("spec");
    });

    it("refuses a spec of another class", async () => {
        const result = await changeSignupFromSetup(event.id, SHAMAN, { status: "signed", spec: "Mage-Fire" }, { user: ORGA, now: NOW });
        expect(result).toMatchObject({ status: 400, code: "spec" });
        expect(signupStore.getSignup(event.id, SHAMAN).spec).toBe("Shaman-Enhancement");
    });

    it("takes a placed raider who is signed off out of groups and bench", async () => {
        expect(slotOf(uid(5))).not.toBeNull();
        const result = await changeSignupFromSetup(event.id, uid(5), { status: "absence" }, { user: ORGA, now: NOW });
        expect(result.error).toBeUndefined();
        expect(signupStore.getSignup(event.id, uid(5)).status).toBe("absence");
        const setup = eventStore.getEvent(event.id).setup;
        expect(slotOf(uid(5))).toBeNull();
        expect(setup.bench.concat(setup.pool).some((p) => p.userId === uid(5))).toBe(false);
    });

    it("is not bound by the deadline", async () => {
        const passed = Math.floor(NOW / 1000) - 60;
        expect(eventStore.updateEvent(event.id, { signupDeadline: passed }).error).toBeUndefined();
        expect(eventStore.getEvent(event.id).signupDeadline).toBe(passed);
        const member = await signupService.submitSignup(event.id, BENCHER, { character: "Wartebank", spec: "Mage-Arcane", status: "signed" }, { now: NOW });
        expect(member.code).toBe("deadline");
        const result = await changeSignupFromSetup(event.id, BENCHER, { status: "signed" }, { user: ORGA, now: NOW });
        expect(result.error).toBeUndefined();
        expect(signupStore.getSignup(event.id, BENCHER).status).toBe("signed");
    });

    it("changes the spec of a raider without a profile inside the class of the character they signed up with", async () => {
        const result = await changeSignupFromSetup(event.id, NOPROFILE, { status: "late", spec: "Priest-Holy" }, { user: ORGA, now: NOW });
        expect(result.error).toBeUndefined();
        expect(signupStore.getSignup(event.id, NOPROFILE)).toMatchObject({ character: "Ohneprofil", spec: "Priest-Holy", status: "late", role: "healer" });
        const other = await changeSignupFromSetup(event.id, NOPROFILE, { status: "signed", spec: "Druid-Balance" }, { user: ORGA, now: NOW });
        expect(other.code).toBe("spec");
    });

    it("keeps an 'im Setup als' spec when only the status changes", async () => {
        const setup = eventStore.getEvent(event.id).setup;
        const placement = {
            groups: setup.groups.map((g) => ({ index: g.index, slots: g.slots.map((s) => (s.userId === uid(1) ? { ...s, spec: "Priest-Shadow", role: "ranged" } : s)) })),
            bench: [],
        };
        expect(setupEditor.saveEventSetup(event.id, placement, { userId: ORGA.id }).error).toBeUndefined();
        await changeSignupFromSetup(event.id, uid(1), { status: "late" }, { user: ORGA, now: NOW });
        expect(signupStore.getSignup(event.id, uid(1))).toMatchObject({ status: "late", spec: "Priest-Holy" });
        expect(slotOf(uid(1))).toMatchObject({ spec: "Priest-Shadow", status: "late" });
    });

    it("answers not_signed_up for somebody who is not signed up and raidhelper for a foreign id", async () => {
        expect(await changeSignupFromSetup(event.id, uid(99), { status: "signed" }, { user: ORGA })).toMatchObject({ status: 404, code: "not_signed_up" });
        expect(await changeSignupFromSetup("1234567", uid(1), { status: "signed" }, { user: ORGA })).toMatchObject({ status: 409, code: "raidhelper" });
        expect(await changeSignupFromSetup(event.id, uid(1), { status: "nope" }, { user: ORGA })).toMatchObject({ status: 400, code: "status" });
    });

    it("works without a stored setup", async () => {
        eventStore.setEventSetup(event.id, null);
        const result = await changeSignupFromSetup(event.id, BENCHER, { status: "late" }, { user: ORGA, now: NOW });
        expect(result.error).toBeUndefined();
        expect(eventStore.getEvent(event.id).setup).toBeFalsy();
    });
});

describe("signupEditView", () => {
    it("offers every spec of the character's class, the profile's first, the others marked", () => {
        const { view } = signupEditView(event.id, SHAMAN);
        expect(view).toMatchObject({ userId: SHAMAN, status: "signed", characters: [{ character: "Donnerfaust", spec: "Shaman-Enhancement" }] });
        expect(view.statuses).toEqual(["signed", "tentative", "late", "bench", "absence"]);
        const [opt] = view.options;
        expect(opt).toMatchObject({ character: "Donnerfaust", classId: "Shaman", inProfile: true });
        expect(opt.specs[0]).toMatchObject({ key: "Shaman-Enhancement", inProfile: true });
        expect(opt.specs.filter((s) => !s.inProfile).map((s) => s.key).sort()).toEqual(["Shaman-Elemental", "Shaman-Restoration"]);
    });

    it("offers a raider without a profile the character they signed up with", () => {
        const { view } = signupEditView(event.id, NOPROFILE);
        expect(view.options).toHaveLength(1);
        expect(view.options[0]).toMatchObject({ character: "Ohneprofil", classId: "Priest", inProfile: false });
        expect(view.options[0].specs.every((s) => !s.inProfile)).toBe(true);
    });

    it("fails for somebody who is not signed up", () => {
        expect(signupEditView(event.id, uid(99)).failed).toMatchObject({ status: 404 });
    });
});

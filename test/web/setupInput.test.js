jest.mock("../../src/web/eventStore", () => ({ getEvent: jest.fn(), listEvents: jest.fn() }));
jest.mock("../../src/web/signupStore", () => ({ listSignups: jest.fn() }));
jest.mock("../../src/web/raiderProfileStore", () => ({ listProfiles: jest.fn() }));
jest.mock("../../src/web/settingsStore", () => ({ getConfig: jest.fn(), getRaidTemplate: jest.fn() }));
jest.mock("../../src/web/rosterAttendance", () => ({ buildAttendanceContext: jest.fn(), attendanceFor: jest.fn() }));
jest.mock("../../src/web/eventSources", () => ({ listStoredEvents: jest.fn() }));

const eventStore = require("../../src/web/eventStore");
const signupStore = require("../../src/web/signupStore");
const profileStore = require("../../src/web/raiderProfileStore");
const settingsStore = require("../../src/web/settingsStore");
const attendance = require("../../src/web/rosterAttendance");
const { listStoredEvents } = require("../../src/web/eventSources");
const { collectSetupInput, proposeSetup, setupMembers, fixedFromSetup } = require("../../src/web/setupInput");

const event = (over = {}) => ({
    id: "eh-new", guildId: "g1", categoryId: "cat", title: "SSC", startTime: 1000,
    versionId: "tbc", size: 10, composition: { tank: 1, healer: 2, melee: 0, ranged: 0 },
    fairness: true, wishes: true, setup: null, ...over,
});

function signup(userId, spec, status = "signed") {
    return { userId, character: userId, spec, status, canAlso: [], comment: "", at: 1 };
}

beforeEach(() => {
    const current = event({
        setup: {
            status: "draft",
            groups: [{ index: 2, slots: [{ userId: "u1", spec: "Warrior-Protection", role: "tank", locked: true }, { userId: "u2", locked: false }] }],
            bench: [{ userId: "u9", locked: true }],
        },
    });
    eventStore.getEvent.mockImplementation((id) => (id === "eh-new" ? current : null));
    eventStore.listEvents.mockReturnValue([]);
    signupStore.listSignups.mockReturnValue([signup("u1", "Warrior-Protection"), signup("u2", "Mage-Fire"), signup("u3", "Priest-Holy", "absence")]);
    profileStore.listProfiles.mockReturnValue([{ userId: "u2", wishes: [], characters: [] }, { userId: "other", characters: [] }]);
    settingsStore.getConfig.mockReturnValue({ categoryRaidTemplate: { cat: "tpl" } });
    settingsStore.getRaidTemplate.mockReturnValue({ id: "tpl", requiredBuffs: ["kings"] });
    attendance.buildAttendanceContext.mockReturnValue({ ctx: true });
    attendance.attendanceFor.mockImplementation((ctx, cat, character) => ({ pct: character === "u1" ? 90 : 40 }));
    listStoredEvents.mockReturnValue([]);
});

describe("setupInput", () => {
    it("collects event, signups, profiles, attendance, required buffs and fixed places", () => {
        const input = collectSetupInput(["eh-new", "missing"], { now: 5000 });
        expect(input.versionId).toBe("tbc");
        expect(input.events).toEqual([expect.objectContaining({ id: "eh-new", size: 10, requiredBuffs: ["kings"], fairness: true, wishes: true })]);
        expect(input.signups.map((s) => [s.userId, s.eventId])).toEqual([["u1", "eh-new"], ["u2", "eh-new"], ["u3", "eh-new"]]);
        expect(input.profiles.map((p) => p.userId)).toEqual(["u2"]);
        expect(input.attendance).toEqual({ u1: 90, u2: 40 });
        expect(attendance.attendanceFor).toHaveBeenCalledWith({ ctx: true }, "cat", "u1", ["u1"]);
        expect(input.fixed).toEqual([
            { userId: "u1", eventId: "eh-new", group: 2, spec: "Warrior-Protection", role: "tank" },
            { userId: "u9", bench: true },
        ]);
        expect(input.historySource).toBe("none");
    });

    it("returns null for unknown events", () => {
        expect(collectSetupInput(["nope"])).toBeNull();
        expect(proposeSetup("nope")).toBeNull();
    });

    it("derives the bench history from approved setups of the category only", () => {
        eventStore.listEvents.mockReturnValue([
            event({ id: "eh-old", startTime: 500, setup: { status: "approved", groups: [{ index: 1, slots: [{ userId: "u1" }] }], bench: [{ userId: "u2" }] } }),
            event({ id: "eh-draft", startTime: 600, setup: { status: "draft", groups: [], bench: [{ userId: "u1" }] } }),
            event({ id: "eh-other", startTime: 700, categoryId: "else", setup: { status: "approved", groups: [], bench: [{ userId: "u1" }] } }),
            event({ id: "eh-later", startTime: 2000, setup: { status: "approved", groups: [], bench: [{ userId: "u1" }] } }),
        ]);
        const input = collectSetupInput("eh-new");
        expect(input.historySource).toBe("setups");
        expect(input.history).toEqual([{ eventId: "eh-old", startTime: 500, placed: ["u1"], bench: ["u2"] }]);
        expect(listStoredEvents).not.toHaveBeenCalled();
    });

    it("falls back to the stored signups while no setup was approved", () => {
        listStoredEvents.mockReturnValue([
            { id: "123", categoryId: "cat", startTime: 800, signUps: [{ userId: "u1", status: "signed" }, { userId: "u2", status: "bench" }, { userId: "u3", status: "absence" }] },
            { id: "124", categoryId: "cat", startTime: 900, signUps: [] },
            { id: "125", categoryId: "else", startTime: 900, signUps: [{ userId: "u2", status: "bench" }] },
        ]);
        const input = collectSetupInput("eh-new");
        expect(input.historySource).toBe("signups");
        expect(input.history).toEqual([{ eventId: "123", startTime: 800, placed: ["u1"], bench: ["u2"] }]);
    });

    it("proposes a setup from the collected input", () => {
        const out = proposeSetup("eh-new");
        expect(out.groups).toHaveLength(2);
        const tank = out.groups[1].slots.find((s) => s.userId === "u1");
        expect(tank).toMatchObject({ locked: true, role: "tank" });
        expect(out.checks.buffs.required).toEqual([expect.objectContaining({ key: "kings", present: false })]);
        expect(out.historySource).toBe("none");
    });

    it("reads placed and benched raiders of single and parallel setups", () => {
        expect(setupMembers({ groups: [{ slots: [{ userId: "a" }] }], bench: [{ userId: "a" }, { userId: "b" }] })).toEqual({ placed: ["a"], bench: ["b"] });
        expect(setupMembers({ events: [{ groups: [{ slots: [{ userId: "c" }] }] }], bench: [] })).toEqual({ placed: ["c"], bench: [] });
        expect(fixedFromSetup({ id: "x", setup: null })).toEqual([]);
    });
});

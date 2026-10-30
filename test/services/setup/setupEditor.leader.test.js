// One leader per raid in the setup editor (#1036): the orga's choice ("Als Leader
// setzen") is stored as `leaderUserId` and survives new proposals, the approval
// writes the leader to `event.leaderId`, and a new leader is a change of the lineup.
const mockEvents = new Map();
jest.mock("../../../src/stores/events/eventStore", () => ({
    getEvent: (id) => (mockEvents.has(id) ? JSON.parse(JSON.stringify(mockEvents.get(id))) : null),
    listEvents: () => [...mockEvents.values()],
    isOwnEventId: (id) => String(id || "").startsWith("eh-"),
    setEventSetup: (id, setup, { leaderId = "" } = {}) => {
        if (!mockEvents.has(id)) return null;
        mockEvents.set(id, { ...mockEvents.get(id), setup: JSON.parse(JSON.stringify(setup)), ...(leaderId ? { leaderId } : {}) });
        return JSON.parse(JSON.stringify(mockEvents.get(id)));
    },
    setEventSetupPost: (id, patch) => {
        if (!mockEvents.has(id)) return null;
        const prev = mockEvents.get(id);
        mockEvents.set(id, { ...prev, setupPost: { ...(prev.setupPost || {}), ...JSON.parse(JSON.stringify(patch)) } });
        return JSON.parse(JSON.stringify(mockEvents.get(id)));
    },
}));
let mockSignups = [];
let mockLeads = {};
jest.mock("../../../src/stores/events/signupStore", () => ({ listSignups: () => mockSignups }));
jest.mock("../../../src/stores/roster/raiderProfileStore", () => ({ listProfiles: () => [] }));
jest.mock("../../../src/stores/roster/leaderFlagsStore", () => ({ allLeads: () => mockLeads }));
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: () => ({}), getRaidTemplate: () => null }));
jest.mock("../../../src/utils/publicUrl", () => ({ publicBaseUrl: () => "https://eh.example" }));
jest.mock("../../../src/services/characters/rosterAttendance", () => ({ buildAttendanceContext: () => ({}), attendanceFor: () => ({ pct: null }) }));
jest.mock("../../../src/services/events/eventSources", () => ({
    listStoredEvents: () => [],
    specNameFor: jest.requireActual("../../../src/services/events/eventSources").specNameFor,
}));

const editor = require("../../../src/services/setup/setupEditor");
const { su } = require("../../utils/setup/fixtures");

const ID = "eh-kara";
const flag = { tbc: { instances: ["kara"], by: "x", at: 1 } };

beforeEach(() => {
    mockEvents.clear();
    mockEvents.set(ID, {
        id: ID, source: "eventhelper", guildId: "g1", categoryId: "cat", title: "Kara", startTime: 2000000000,
        versionId: "tbc", instanceIds: ["kara"], leaderId: "creator", size: 10,
        composition: { tank: 1, healer: 2, melee: 0, ranged: 0 }, fairness: false, wishes: false, setup: null,
    });
    mockSignups = [
        su("tank", "Warrior-Protection"), su("heal1", "Priest-Holy"), su("heal2", "Paladin-Holy"),
        su("mage", "Mage-Fire"), su("rogue", "Rogue-Combat"), su("lock", "Warlock-Destruction"),
        su("hunter", "Hunter-BeastMastery"), su("sham", "Shaman-Enhancement"), su("feral", "Druid-Feral"),
        su("spriest", "Priest-Shadow"), su("frost", "Mage-Frost"), su("arms", "Warrior-Arms"),
    ];
    // "rogue" may lead Karazhan, "frost" only Gruul
    mockLeads = { rogue: flag, frost: { tbc: { instances: ["gruul"], by: "x", at: 1 } } };
});

const leaders = (setup) => setup.groups.flatMap((g) => g.slots.filter((s) => s.leader)).map((s) => s.userId);
const placed = (setup) => setup.groups.flatMap((g) => g.slots.map((s) => s.userId));
function placementOf(setup) {
    return {
        version: setup.version,
        groups: setup.groups.map((g) => ({ index: g.index, slots: g.slots.map((s) => ({ userId: s.userId, spec: s.spec, role: s.role, locked: s.locked })) })),
        bench: setup.bench.map((b) => ({ userId: b.userId, locked: b.locked })),
    };
}

describe("the leader in the setup editor (#1036)", () => {
    it("proposes the flagged raider as leader, without storing that as the orga's choice", () => {
        const { setup } = editor.proposeEventSetup(ID);
        expect(leaders(setup)).toEqual(["rogue"]);
        expect(setup.checks.leader).toEqual({ count: 1, ok: true, candidates: ["rogue"] });
        expect(setup.leaderUserId).toBeUndefined();
    });

    it("the approval makes the leader the event's leader and keeps the crown in the snapshot", () => {
        const { setup } = editor.proposeEventSetup(ID);
        editor.approveEventSetup(ID, { version: setup.version, userId: "orga" });
        const event = mockEvents.get(ID);
        expect(event.leaderId).toBe("rogue");
        expect(event.setup.approved.groups.flatMap((g) => g.slots).filter((s) => s.leader).map((s) => s.userId)).toEqual(["rogue"]);
    });

    it("an approval without a leader leaves the event's leader alone", () => {
        mockLeads = {};
        const { setup } = editor.proposeEventSetup(ID);
        expect(setup.checks.leader.ok).toBe(false);
        editor.approveEventSetup(ID, { version: setup.version });
        expect(mockEvents.get(ID).leaderId).toBe("creator");
    });

    it("the orga's choice (even without a flag) leads, stays through new proposals and filling, and leaderId follows", () => {
        const first = editor.proposeEventSetup(ID).setup;
        const chosen = placed(first).find((u) => !["rogue", "tank", "heal1", "heal2"].includes(u));
        const saved = editor.saveEventSetup(ID, { ...placementOf(first), leaderUserId: chosen }).setup;
        expect(saved.leaderUserId).toBe(chosen);
        expect(leaders(saved)).toEqual([chosen]);
        for (const body of [{}, { keep: "placed" }, { weights: { mainSpec: 0, status: 0 } }]) {
            const again = editor.proposeEventSetup(ID, body).setup;
            expect(again.leaderUserId).toBe(chosen);
            expect(placed(again)).toContain(chosen);
            expect(leaders(again)).toEqual([chosen]);
        }
        editor.approveEventSetup(ID, { version: mockEvents.get(ID).setup.version });
        expect(mockEvents.get(ID).leaderId).toBe(chosen);
    });

    it("a save without leaderUserId keeps the stored choice, an empty one clears it, one outside the groups is dropped", () => {
        const first = editor.proposeEventSetup(ID).setup;
        const saved = editor.saveEventSetup(ID, { ...placementOf(first), leaderUserId: "mage" }).setup;
        expect(saved.leaderUserId).toBe("mage");
        expect(editor.saveEventSetup(ID, placementOf(saved)).setup.leaderUserId).toBe("mage");
        const cleared = editor.saveEventSetup(ID, { ...placementOf(mockEvents.get(ID).setup), leaderUserId: "" }).setup;
        expect(cleared.leaderUserId).toBeUndefined();
        expect(leaders(cleared)).toEqual(["rogue"]);
        const pooled = mockEvents.get(ID).setup.pool.map((p) => p.userId)[0];
        const outside = editor.saveEventSetup(ID, { ...placementOf(mockEvents.get(ID).setup), leaderUserId: pooled }).setup;
        expect(outside.leaderUserId).toBeUndefined();
    });

    it("a new leader is a change of the approved lineup", () => {
        const { setup } = editor.proposeEventSetup(ID);
        editor.approveEventSetup(ID, { version: setup.version });
        const other = placed(setup).find((u) => u !== "rogue");
        const saved = editor.saveEventSetup(ID, { ...placementOf(mockEvents.get(ID).setup), leaderUserId: other }).setup;
        expect(saved).toMatchObject({ status: "draft", changedSinceApproval: true });
        expect(saved.approved.groups.flatMap((g) => g.slots).filter((s) => s.leader).map((s) => s.userId)).toEqual(["rogue"]);
        expect(mockEvents.get(ID).leaderId).toBe("rogue");
    });

    it("the signature counts the leader only when there is one", () => {
        const groups = [{ index: 1, slots: [{ userId: "a" }, { userId: "b" }] }];
        expect(editor._internal.lineupSignature({ groups })).not.toMatch(/leader/);
        const marked = [{ index: 1, slots: [{ userId: "a" }, { userId: "b", leader: true }] }];
        expect(editor._internal.lineupSignature({ groups: marked })).toBe(`${editor._internal.lineupSignature({ groups })}|leader:b`);
    });
});

// One leader per raid in the setup editor (#1036): the orga's choice ("Als Leader
// setzen") is stored as `leaderUserId` and survives new proposals, the approval
// writes the leader to `event.leaderId`, and a new leader is a change of the lineup.
const mockEvents = new Map();
jest.mock("../../../src/stores/events/eventStore", () => ({
    getEvent: (id) => (mockEvents.has(id) ? JSON.parse(JSON.stringify(mockEvents.get(id))) : null),
    listEvents: (guildId) => [...mockEvents.values()].filter((e) => !guildId || e.guildId === guildId),
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
let mockSignupsOf = {};
jest.mock("../../../src/stores/events/signupStore", () => ({ listSignups: () => mockSignups, signupsOfUser: (uid) => mockSignupsOf[uid] || {} }));
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
const { placementsOf, placementSignature } = require("../../../src/services/setup/setupMessage");
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
    mockSignupsOf = {};
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
        // the rule holds (a Kara flag holder signed up to an upcoming raid of g1), but nobody placed may lead
        mockLeads = { outsider: flag };
        mockEvents.set("eh-other", { id: "eh-other", guildId: "g1", title: "Kara", startTime: 2000000000 });
        mockSignupsOf = { outsider: { "eh-other": { status: "signed" } } };
        const { setup } = editor.proposeEventSetup(ID);
        expect(setup.checks.leader.ok).toBe(false);
        expect(leaders(setup)).toEqual([]);
        editor.approveEventSetup(ID, { version: setup.version });
        expect(mockEvents.get(ID).leaderId).toBe("creator");
    });

    it("without any leader flag on the server: no leader rule, all as before #1036", () => {
        mockLeads = {};
        const { setup } = editor.proposeEventSetup(ID);
        expect(setup.checks.leader).toBeUndefined();
        expect(leaders(setup)).toEqual([]);
        editor.approveEventSetup(ID, { version: setup.version });
        expect(mockEvents.get(ID).leaderId).toBe("creator");
    });

    it("without a rule there is no crown: not for the placed raid lead (event.leaderId), not for a stored orga choice", () => {
        mockLeads = {};
        mockEvents.set(ID, { ...mockEvents.get(ID), leaderId: "heal1" });
        const { setup } = editor.proposeEventSetup(ID);
        expect(setup.checks.leader).toBeUndefined();
        expect(placed(setup)).toContain("heal1");
        expect(leaders(setup)).toEqual([]);
        const saved = editor.saveEventSetup(ID, { ...placementOf(setup), leaderUserId: "heal1" }).setup;
        expect(leaders(saved)).toEqual([]);
        expect(saved.leaderUserId).toBeUndefined();
        expect(mockEvents.get(ID).leaderId).toBe("heal1");
    });

    it("an approved setup on a server without flags stays approved after a new computation, signatures unchanged", () => {
        mockLeads = {};
        mockEvents.set(ID, { ...mockEvents.get(ID), leaderId: "heal1" });
        const { setup } = editor.proposeEventSetup(ID);
        expect(placed(setup)).toContain("heal1");
        editor.approveEventSetup(ID, { version: setup.version, userId: "orga" });
        const approved = mockEvents.get(ID).setup;
        expect(approved.status).toBe("approved");
        const lineup = editor._internal.lineupSignature(approved);
        const placement = placementsOf(approved.approved).map(placementSignature);
        const again = editor.saveEventSetup(ID, placementOf(approved)).setup;
        expect(again.status).toBe("approved");
        expect(again.changedSinceApproval).toBeFalsy();
        expect(editor._internal.lineupSignature(again)).toBe(lineup);
        expect(lineup).not.toMatch(/leader/);
        expect(placementsOf(again.approved).map(placementSignature)).toEqual(placement);
        expect(placement.join()).not.toMatch(/\/lead/);
        expect(leaders(again)).toEqual([]);
        expect(approved.approved.groups.flatMap((g) => g.slots).some((s) => s.leader)).toBe(false);
        expect(mockEvents.get(ID).leaderId).toBe("heal1");
    });

    it("a flag counts for the server when its holder signed up to an upcoming event of it, else not", () => {
        mockLeads = { outsider: flag };
        expect(editor.proposeEventSetup(ID).setup.checks.leader).toBeUndefined();
        mockEvents.set("eh-other", { id: "eh-other", guildId: "g1", title: "Gruul", startTime: 2000000000 });
        mockSignupsOf = { outsider: { "eh-other": { status: "signed" } } };
        const ruled = editor.proposeEventSetup(ID).setup;
        expect(ruled.checks.leader).toEqual({ count: 0, ok: false, candidates: [] });
    });

    it("no rule when the flag holder signed up only to an event of another server", () => {
        mockLeads = { outsider: flag };
        mockEvents.set("eh-g2", { id: "eh-g2", guildId: "g2", title: "Kara", startTime: 2000000000 });
        mockSignupsOf = { outsider: { "eh-g2": { status: "signed" } } };
        expect(editor.proposeEventSetup(ID).setup.checks.leader).toBeUndefined();
    });

    it("no rule when the flag holder signed up only to a past event of the server", () => {
        mockLeads = { outsider: flag };
        mockEvents.set("eh-past", { id: "eh-past", guildId: "g1", title: "Kara", startTime: 1000000000 });
        mockSignupsOf = { outsider: { "eh-past": { status: "signed" } } };
        expect(editor.proposeEventSetup(ID).setup.checks.leader).toBeUndefined();
    });

    it("no rule when the only flag on the server is for another instance (Gruul flag, Kara raid)", () => {
        mockLeads = { frost: { tbc: { instances: ["gruul"], by: "x", at: 1 } } };
        const { setup } = editor.proposeEventSetup(ID);
        expect(setup.checks.leader).toBeUndefined();
        expect(leaders(setup)).toEqual([]);
    });

    it("no rule for an event without a server", () => {
        mockEvents.set(ID, { ...mockEvents.get(ID), guildId: "" });
        expect(editor.proposeEventSetup(ID).setup.checks.leader).toBeUndefined();
    });

    it("the placed raid lead leads before an earlier signed-up flag holder and stays the event's leader", () => {
        mockSignups = [su("creator", "Warrior-Protection"), ...mockSignups.filter((s) => s.userId !== "tank")];
        mockSignups.unshift(mockSignups.splice(mockSignups.findIndex((s) => s.userId === "rogue"), 1)[0]);
        const { setup } = editor.proposeEventSetup(ID);
        expect(placed(setup)).toEqual(expect.arrayContaining(["creator", "rogue"]));
        expect(leaders(setup)).toEqual(["creator"]);
        editor.approveEventSetup(ID, { version: setup.version });
        expect(mockEvents.get(ID).leaderId).toBe("creator");
    });

    it("a live save does not reset a raid lead changed in the event edit", () => {
        const { setup } = editor.proposeEventSetup(ID);
        editor.approveEventSetup(ID, { version: setup.version });
        expect(mockEvents.get(ID).leaderId).toBe("rogue");
        // posted, then the orga changes the raid lead in the event edit
        mockEvents.set(ID, { ...mockEvents.get(ID), setupPost: { channelId: "c1", messageId: "m1" }, leaderId: "heal1" });
        const saved = editor.saveEventSetup(ID, placementOf(mockEvents.get(ID).setup));
        expect(saved.live).toBe(true);
        expect(mockEvents.get(ID).leaderId).toBe("heal1");
        expect(leaders(saved.setup)).toEqual(["heal1"]);
    });

    it("leaderIdFor: the orga's choice wins, a raid lead in the raid stays, an absent one is replaced", () => {
        const { leaderIdFor } = editor._internal;
        const groups = [{ index: 1, slots: [{ userId: "a" }, { userId: "b", leader: true }] }];
        expect(leaderIdFor({ leaderId: "a" }, { groups })).toBe("");
        expect(leaderIdFor({ leaderId: "a" }, { groups, leaderUserId: "b" })).toBe("b");
        expect(leaderIdFor({ leaderId: "gone" }, { groups })).toBe("b");
        expect(leaderIdFor({}, { groups })).toBe("b");
        expect(leaderIdFor({ leaderId: "a" }, { groups: [{ index: 1, slots: [{ userId: "a" }] }] })).toBe("");
    });

    it("the orga's choice holds for the run but never turns into a lock, not even after a change of leader", () => {
        const first = editor.proposeEventSetup(ID).setup;
        const [a, b] = placed(first).filter((u) => !["rogue", "tank", "heal1", "heal2"].includes(u));
        editor.saveEventSetup(ID, { ...placementOf(first), leaderUserId: a });
        const slotOf = (setup, uid) => setup.groups.flatMap((g) => g.slots).find((s) => s.userId === uid);
        const again = editor.proposeEventSetup(ID).setup;
        expect(slotOf(again, a)).toMatchObject({ leader: true, locked: false });
        expect(slotOf(again, a).reasons).not.toContain("Von der Orga fixiert");
        editor.saveEventSetup(ID, { ...placementOf(again), leaderUserId: b });
        const third = editor.proposeEventSetup(ID).setup;
        expect(leaders(third)).toEqual([b]);
        const old = slotOf(third, a);
        if (old) {
            expect(old.locked).toBe(false);
            expect(old.reasons).not.toContain("Von der Orga fixiert");
        }
        expect(slotOf(third, b).locked).toBe(false);
    });

    it("a lock the orga set itself stays when that raider is also the chosen leader", () => {
        const first = editor.proposeEventSetup(ID).setup;
        const a = placed(first).find((u) => !["rogue", "tank", "heal1", "heal2"].includes(u));
        const body = placementOf(first);
        body.groups.forEach((g) => g.slots.forEach((s) => { if (s.userId === a) s.locked = true; }));
        editor.saveEventSetup(ID, { ...body, leaderUserId: a });
        const again = editor.proposeEventSetup(ID).setup;
        expect(again.groups.flatMap((g) => g.slots).find((s) => s.userId === a)).toMatchObject({ leader: true, locked: true });
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

// A category switched to another game version (#739): the old roster is closed,
// a new one may start - with the people, without their characters.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const rosterStore = require("../../../src/stores/rosterStore");
const configStore = require("../../../src/stores/configStore");
const { notifyCategoryVersionSwitch } = require("../../../src/services/events/categorySwitch");
const {
    applyRosterSwitch, switchRosterPreview, registerRosterVersionSwitch, cleanChoice,
} = require("../../../src/services/roster/rosterVersionSwitch");

const NOW = "2026-10-11T12:00:00.000Z";
const U1 = "200000000000000001";
const U2 = "200000000000000002";
const U3 = "200000000000000003";
const SW = { categoryId: "c1", fromVersion: "tbc", toVersion: "forever", at: Date.parse(NOW), name: "Montag" };

/** The TBC roster of c1 with three members, roles and a Kader, the config as it is after the save of the switch. */
function tbcRoster() {
    const r = rosterStore.createRoster({
        guildId: "g1", name: "Montag", categoryId: "c1", versionId: "tbc", roleIds: ["500000000000000001"], trialRoleId: "500000000000000009",
        managers: { userIds: [U3], roleIds: [] }, slots: { total: 25, tank: 3, healer: 6, bench: 2 }, signupOnly: true, publicRaids: true, kaderId: "k1",
    });
    rosterStore.upsertMember(r.id, U1, { status: "core", chars: ["Keslight"], note: "Raidlead" });
    rosterStore.upsertMember(r.id, U2, { status: "pause", chars: ["Devi"] });
    rosterStore.upsertMember(r.id, U3, { status: "bench", chars: ["Holy"] });
    configStore.saveConfig({ categoryIds: ["c1"], categoryVersion: { c1: "forever" }, categoryRoles: { c1: ["500000000000000001"] } });
    return rosterStore.getRoster(r.id);
}

beforeEach(() => {
    fs.__store.clear();
});

describe("services/roster/rosterVersionSwitch applyRosterSwitch", () => {
    it("closes the old roster and starts the new one with the people as Probe, without characters", () => {
        const old = tbcRoster();
        const out = applyRosterSwitch(SW, { choice: { create: true, copyMembers: true }, actor: "a1", now: NOW });
        expect(out.closed).toEqual({ id: old.id, name: "Montag" });
        const closed = rosterStore.getRoster(old.id);
        expect(closed).toMatchObject({ closedAt: NOW, closedReason: "version_switch", kaderId: null });
        // the old roster keeps its members, characters and roles exactly
        expect(closed.members[U1]).toMatchObject({ status: "core", chars: ["keslight"] });
        expect(closed.roleIds).toEqual(["500000000000000001"]);

        const next = rosterStore.rosterForCategory("c1", "forever");
        expect(out.created).toEqual({ id: next.id, name: "Montag", members: 3 });
        expect(next).toMatchObject({
            guildId: "g1", versionId: "forever", roleIds: [], trialRoleId: null, closedAt: null, kaderId: "k1",
            managers: { userIds: [U3], roleIds: [] }, slots: { total: 25, tank: 3, healer: 6, bench: 2 }, signupOnly: true, publicRaids: true,
            source: { kind: "manual" },
        });
        expect(next.members[U1]).toEqual({ status: "trial", since: NOW, by: "a1", chars: [], charNames: {}, note: "Raidlead", spec: "", trialUntil: null });
        expect(next.members[U2].status).toBe("pause");
        expect(next.members[U3]).toMatchObject({ status: "trial", chars: [] });
        expect(next.history.map((h) => h.what)).toEqual(["created", "members-copied"]);
        expect(next.history[1].detail).toBe("3 · Montag");
        // the settings' raider roles now mirror the new roster: none until set in the roster form
        expect(out.mirrored).toBe(true);
        expect(configStore.getConfig().categoryRoles.c1 || []).toEqual([]);
    });

    it("takes the roles picked in the dialog for the new roster and mirrors them", () => {
        tbcRoster();
        applyRosterSwitch(SW, { choice: { roleIds: ["500000000000000002", "junk", "500000000000000002"] }, now: NOW });
        expect(rosterStore.rosterForCategory("c1", "forever").roleIds).toEqual(["500000000000000002"]);
        expect(configStore.getConfig().categoryRoles.c1).toEqual(["500000000000000002"]);
    });

    it("without 'Personen übernehmen' the new roster starts empty; without 'anlegen' there is none", () => {
        tbcRoster();
        applyRosterSwitch(SW, { choice: { create: true, copyMembers: false }, now: NOW });
        const next = rosterStore.rosterForCategory("c1", "forever");
        expect(next.members).toEqual({});
        expect(next.history.map((h) => h.what)).toEqual(["created"]);

        fs.__store.clear();
        const old = tbcRoster();
        const out = applyRosterSwitch(SW, { choice: { create: false }, now: NOW });
        expect(out.created).toBeNull();
        expect(rosterStore.rosterForCategory("c1", "forever")).toBeNull();
        expect(rosterStore.getRoster(old.id).closedAt).toBe(NOW);
        // the roles mirrored the closed roster - now the category has none
        expect(configStore.getConfig().categoryRoles.c1 || []).toEqual([]);
    });

    it("a roster of the new version made before keeps everything and its roles are mirrored", () => {
        const old = tbcRoster();
        const pre = rosterStore.createRoster({ guildId: "g1", name: "Forever", categoryId: "c1", versionId: "forever", roleIds: ["500000000000000003"] });
        const out = applyRosterSwitch(SW, { choice: { create: true }, now: NOW });
        expect(out).toMatchObject({ closed: { id: old.id }, created: null, reopened: null });
        expect(rosterStore.rosterForCategory("c1", "forever").id).toBe(pre.id);
        expect(configStore.getConfig().categoryRoles.c1).toEqual(["500000000000000003"]);
    });

    it("switching back opens the roster a switch closed, and closes the other one", () => {
        const old = tbcRoster();
        applyRosterSwitch(SW, { now: NOW });
        const forever = rosterStore.rosterForCategory("c1", "forever");
        configStore.saveConfig({ categoryVersion: { c1: "tbc" } });
        const back = applyRosterSwitch({ ...SW, fromVersion: "forever", toVersion: "tbc" }, { now: NOW });
        expect(back.closed).toEqual({ id: forever.id, name: "Montag" });
        expect(back.reopened).toEqual({ id: old.id, name: "Montag" });
        expect(rosterStore.getRoster(old.id).closedAt).toBeNull();
        expect(configStore.getConfig().categoryRoles.c1).toEqual(["500000000000000001"]);
    });

    it("a category without a roster: nothing to close, nothing created, its roles stay", () => {
        configStore.saveConfig({ categoryIds: ["c1"], categoryVersion: { c1: "forever" }, categoryRoles: { c1: ["500000000000000001"] } });
        expect(applyRosterSwitch(SW, { now: NOW })).toEqual({ closed: null, reopened: null, created: null, mirrored: false });
        expect(configStore.getConfig().categoryRoles.c1).toEqual(["500000000000000001"]);
        expect(applyRosterSwitch({ ...SW, toVersion: "tbc" })).toEqual({ closed: null, reopened: null, created: null, mirrored: false });
        expect(applyRosterSwitch(null)).toEqual({ closed: null, reopened: null, created: null, mirrored: false });
    });

    it("cleanChoice: create and copy on by default, roles as unique snowflakes", () => {
        expect(cleanChoice(undefined)).toEqual({ create: true, copyMembers: true, roleIds: [] });
        expect(cleanChoice({ create: false, copyMembers: false, roleIds: ["1", "500000000000000001", "500000000000000001"] }))
            .toEqual({ create: false, copyMembers: false, roleIds: ["500000000000000001"] });
    });
});

describe("services/roster/rosterVersionSwitch switchRosterPreview", () => {
    it("names the roster that closes, the one of the new version and whether one can be created", () => {
        expect(switchRosterPreview("c1", { fromVersion: "tbc", toVersion: "forever" })).toEqual({ closing: null, existing: null, canCreate: false });
        const old = tbcRoster();
        expect(switchRosterPreview("c1", { fromVersion: "tbc", toVersion: "forever" }))
            .toEqual({ closing: { id: old.id, name: "Montag", members: 3 }, existing: null, canCreate: true });
        applyRosterSwitch(SW, { now: NOW });
        const forever = rosterStore.rosterForCategory("c1", "forever");
        expect(switchRosterPreview("c1", { fromVersion: "forever", toVersion: "tbc" })).toEqual({
            closing: { id: forever.id, name: "Montag", members: 3 },
            existing: { id: old.id, name: "Montag", closed: true, reopens: true },
            canCreate: false,
        });
        expect(switchRosterPreview("c1", { fromVersion: "tbc", toVersion: "tbc" })).toEqual({ closing: null, existing: null, canCreate: false });
        expect(switchRosterPreview("", { fromVersion: "tbc", toVersion: "forever" })).toEqual({ closing: null, existing: null, canCreate: false });
    });
});

describe("services/roster/rosterVersionSwitch as the categorySwitch hook", () => {
    it("runs once per switch with the dialog's choice and answers what it did", async () => {
        const off = registerRosterVersionSwitch();
        expect(registerRosterVersionSwitch()).toBe(off);
        try {
            const old = tbcRoster();
            const [entry] = await notifyCategoryVersionSwitch([{ ...SW, series: "" }], {
                user: { id: "a1" }, fixes: { c1: { series: "", roster: { create: true, copyMembers: false, roleIds: [] } } },
            });
            expect(entry).toMatchObject({ categoryId: "c1", series: "", roster: { closed: { id: old.id }, created: { members: 0 } } });
            const closed = rosterStore.getRoster(old.id);
            expect(closed.history[closed.history.length - 1]).toMatchObject({ what: "closed", by: "a1", detail: "version_switch" });
        } finally {
            off();
        }
        // unregistered: a further switch leaves the rosters alone
        fs.__store.clear();
        const again = tbcRoster();
        const [plain] = await notifyCategoryVersionSwitch([SW], {});
        expect(plain.roster).toBeUndefined();
        expect(rosterStore.getRoster(again.id).closedAt).toBeNull();
    });
});

// rosterRoleSync (#656): roster and Discord role in both directions - the tool
// gives/takes roles after its store write, Discord role changes add/remove
// members, the reconcile catches what the events missed. No loop, no mass wipe.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/services/discord/memberRoles", () => ({
    giveRole: jest.fn(),
    takeRole: jest.fn(),
    recentWrite: jest.fn(() => undefined),
}));
jest.mock("../../../src/services/discord/discord", () => ({
    isOnline: jest.fn(() => true),
    getGuild: jest.fn(() => ({ id: "g1", roles: { cache: new Map([["main", {}], ["alt", {}], ["trial", {}]]) } })),
    fetchGuildMembersCached: jest.fn(async () => []),
}));
jest.mock("../../../src/stores/raiderProfileStore", () => ({
    getProfile: jest.fn((userId) => ({ userId, name: "", characters: [] })),
    firstCharacter: jest.fn(() => null),
}));

const fs = require("fs");
const memberRoles = require("../../../src/services/discord/memberRoles");
const discord = require("../../../src/services/discord/discord");
const raiderProfileStore = require("../../../src/stores/raiderProfileStore");
const rosterStore = require("../../../src/stores/rosterStore");
const sync = require("../../../src/services/roster/rosterRoleSync");

const ok = (roleId, changed = true) => ({ ok: true, code: changed ? "done" : "unchanged", changed, roleId, roleName: roleId.toUpperCase() });

/** A gateway member with these roles. */
function member(id, roleIds = [], { bot = false, partial = false } = {}) {
    return {
        id,
        partial,
        user: { bot },
        guild: { id: "g1" },
        displayName: `N${id}`,
        roles: { cache: new Map(roleIds.map((r) => [r, {}])) },
    };
}

let roster;
beforeEach(() => {
    fs.__store.clear();
    jest.clearAllMocks();
    sync._resetForTests();
    memberRoles.giveRole.mockImplementation(async (g, u, r) => ok(r));
    memberRoles.takeRole.mockImplementation(async (g, u, r) => ok(r));
    memberRoles.recentWrite.mockReturnValue(undefined);
    discord.isOnline.mockReturnValue(true);
    roster = rosterStore.createRoster({ name: "Donnerstag", guildId: "g1", roleIds: ["main", "alt"], trialRoleId: "trial", versionId: "tbc" });
});

const fresh = () => rosterStore.getRoster(roster.id);
const lastLines = (n) => fresh().history.slice(-n).map((h) => [h.what, h.detail, h.by, h.userId]);

describe("services/roster/rosterRoleSync tool side", () => {
    it("gives the main role to a new member, and the trial role for status trial", async () => {
        rosterStore.upsertMember(roster.id, "100001", { status: "trial" });
        const res = await sync.applyMemberAdded(roster.id, "100001", { actor: "o1" });
        expect(memberRoles.giveRole.mock.calls).toEqual([["g1", "100001", "main"], ["g1", "100001", "trial"]]);
        expect(res.ok).toBe(true);
        expect(res.results.map((r) => [r.roleId, r.give, r.code])).toEqual([["main", true, "done"], ["trial", true, "done"]]);
        expect(lastLines(2)).toEqual([["role-given", "@MAIN", "o1", "100001"], ["role-given", "@TRIAL", "o1", "100001"]]);
    });

    it("a core member gets only the main role", async () => {
        rosterStore.upsertMember(roster.id, "100001", {});
        await sync.applyMemberAdded(roster, "100001");
        expect(memberRoles.giveRole.mock.calls).toEqual([["g1", "100001", "main"]]);
    });

    it("writes a failure line with the reason code, and none for nothing to do", async () => {
        rosterStore.upsertMember(roster.id, "100001", {});
        memberRoles.giveRole.mockResolvedValueOnce({ ok: false, code: "role_too_high", changed: false, roleId: "main", roleName: "Raider" });
        const res = await sync.applyMemberAdded(roster.id, "100001", { actor: "o1" });
        expect(res.ok).toBe(false);
        expect(lastLines(1)).toEqual([["role-give-failed", "@Raider: role_too_high", "o1", "100001"]]);
        const count = fresh().history.length;
        memberRoles.giveRole.mockResolvedValueOnce(ok("main", false));
        await sync.applyMemberAdded(roster.id, "100001");
        expect(fresh().history).toHaveLength(count);
    });

    it("moves the trial role on status changes, and nothing for pause or bench", async () => {
        await sync.applyStatusChange(roster.id, "100001", "core", "trial");
        expect(memberRoles.giveRole).toHaveBeenLastCalledWith("g1", "100001", "trial");
        await sync.applyStatusChange(roster.id, "100001", "trial", "core");
        expect(memberRoles.takeRole).toHaveBeenLastCalledWith("g1", "100001", "trial");
        jest.clearAllMocks();
        expect((await sync.applyStatusChange(roster.id, "100001", "core", "pause")).skipped).toBe("no_roles");
        await sync.applyStatusChange(roster.id, "100001", "pause", "bench");
        await sync.applyStatusChange(roster.id, "100001", "trial", "trial");
        expect(memberRoles.giveRole).not.toHaveBeenCalled();
        expect(memberRoles.takeRole).not.toHaveBeenCalled();
    });

    it("takes every role of the roster on removal; not being on the server is no failure", async () => {
        memberRoles.takeRole.mockImplementation(async (g, u, r) => (r === "alt"
            ? { ok: false, code: "not_member", changed: false, roleId: r, roleName: "" }
            : ok(r)));
        const res = await sync.applyMemberRemoved(roster.id, "100001", { actor: "o1" });
        expect(memberRoles.takeRole.mock.calls.map((c) => c[2])).toEqual(["main", "alt", "trial"]);
        expect(res.results).toHaveLength(3);
        expect(lastLines(2).map((l) => l[0])).toEqual(["role-taken", "role-taken"]);
    });

    it("skips a roster without server and an unknown roster, and never throws", async () => {
        const noGuild = rosterStore.createRoster({ name: "Ohne", roleIds: ["x"] });
        expect(await sync.applyMemberAdded(noGuild.id, "100001")).toEqual({ ok: true, skipped: "no_guild", results: [] });
        expect(await sync.applyMemberRemoved("nope", "100001")).toEqual({ ok: false, skipped: "no_roster", results: [] });
        memberRoles.giveRole.mockRejectedValueOnce(new Error("boom"));
        const res = await sync.applyRoleChange(fresh(), "100001", "main", true);
        expect(res).toEqual({ roleId: "main", roleName: "", give: true, ok: false, code: "failed", changed: false });
    });
});

describe("services/roster/rosterRoleSync Discord side (events)", () => {
    it("adds a member who gains a roster role: core, the profile's first character, via Discord", () => {
        raiderProfileStore.firstCharacter.mockReturnValueOnce({ key: "devi", name: "Devi", className: "Priest" });
        const changes = sync.onGuildMemberUpdate(member("100001", []), member("100001", ["alt"]));
        expect(changes).toEqual([{ rosterId: roster.id, userId: "100001", action: "added" }]);
        const m = fresh().members["100001"];
        expect(m).toEqual(expect.objectContaining({ status: "core", chars: ["devi"], charNames: { devi: "Devi" } }));
        expect(raiderProfileStore.firstCharacter).toHaveBeenCalledWith(expect.anything(), "tbc");
        expect(lastLines(1)).toEqual([["member-added", "via Discord · core, devi", "", "100001"]]);
    });

    it("removes a member who loses the last roster role; the history line stays", () => {
        rosterStore.upsertMember(roster.id, "100001", {});
        expect(sync.onGuildMemberUpdate(member("100001", ["main", "alt"]), member("100001", ["alt"]))).toEqual([]);
        expect(fresh().members["100001"]).toBeTruthy();
        const changes = sync.onGuildMemberUpdate(member("100001", ["alt"]), member("100001", []));
        expect(changes).toEqual([{ rosterId: roster.id, userId: "100001", action: "removed" }]);
        expect(fresh().members["100001"]).toBeUndefined();
        expect(lastLines(1)).toEqual([["member-removed", "via Discord", "", "100001"]]);
    });

    it("no loop: the events of the tool's own role writes find nothing to do", () => {
        // tool added (store first), then the role arrives
        rosterStore.upsertMember(roster.id, "100001", { status: "trial" });
        const lines = fresh().history.length;
        expect(sync.onGuildMemberUpdate(member("100001", []), member("100001", ["main"]))).toEqual([]);
        expect(sync.onGuildMemberUpdate(member("100001", ["main"]), member("100001", ["main", "trial"]))).toEqual([]);
        // tool removed (store first), then the roles go
        rosterStore.removeMember(roster.id, "100001");
        expect(sync.onGuildMemberUpdate(member("100001", ["main", "trial"]), member("100001", []))).toEqual([]);
        expect(fresh().history).toHaveLength(lines + 1);
        expect(memberRoles.giveRole).not.toHaveBeenCalled();
        expect(memberRoles.takeRole).not.toHaveBeenCalled();
    });

    it("is idempotent and ignores role changes outside the roster, bots and the trial role", () => {
        sync.onGuildMemberUpdate(member("100001", []), member("100001", ["main"]));
        const lines = fresh().history.length;
        expect(sync.onGuildMemberUpdate(member("100001", []), member("100001", ["main"]))).toEqual([]);
        expect(sync.onGuildMemberUpdate(member("100002", []), member("100002", ["other", "trial"]))).toEqual([]);
        expect(sync.onGuildMemberUpdate(member("100003", []), member("100003", ["main"], { bot: true }))).toEqual([]);
        expect(sync.onGuildMemberUpdate(null, null)).toEqual([]);
        expect(fresh().history).toHaveLength(lines);
    });

    it("pause members are members: a role change elsewhere keeps them", () => {
        rosterStore.upsertMember(roster.id, "100001", { status: "pause" });
        expect(sync.onGuildMemberUpdate(member("100001", ["main"]), member("100001", ["main", "other"]))).toEqual([]);
        expect(fresh().members["100001"].status).toBe("pause");
    });

    it("with unknown old roles (partial member) it adds a holder but never removes", () => {
        expect(sync.onGuildMemberUpdate(member("100001", [], { partial: true }), member("100001", ["main"]))).toHaveLength(1);
        rosterStore.upsertMember(roster.id, "100002", {});
        expect(sync.onGuildMemberUpdate(member("100002", [], { partial: true }), member("100002", []))).toEqual([]);
        expect(fresh().members["100002"]).toBeTruthy();
    });

    it("guildMemberAdd counts every roster role the newcomer brings as gained", () => {
        expect(sync.onGuildMemberAdd(member("100001", ["alt"]))).toHaveLength(1);
        expect(sync.onGuildMemberAdd(member("100002", ["other"]))).toEqual([]);
    });

    it("does not re-add someone the tool removed but could not take the role from, until the role is given anew", () => {
        rosterStore.upsertMember(roster.id, "100001", {});
        rosterStore.removeMember(roster.id, "100001", { actor: "o1" });
        rosterStore.appendHistory(roster.id, { by: "o1", userId: "100001", what: "role-take-failed", detail: "@MAIN: no_permission" });
        expect(sync.takeFailedPending(fresh(), "100001")).toBe(true);
        expect(sync.onGuildMemberUpdate(member("100001", ["main"], { partial: true }), member("100001", ["main"]))).toEqual([]);
        // a person gives a roster role again in Discord: that is a decision, they are in
        expect(sync.onGuildMemberUpdate(member("100001", ["main"]), member("100001", ["main", "alt"]))).toHaveLength(1);
        expect(sync.takeFailedPending(fresh(), "100001")).toBe(false);
    });

    it("never throws when the store write fails (member limit)", () => {
        const spy = jest.spyOn(rosterStore, "upsertMember").mockImplementationOnce(() => { throw new rosterStore.RosterError("member_limit"); });
        expect(sync.onGuildMemberUpdate(member("100001", []), member("100001", ["main"]))).toEqual([]);
        spy.mockRestore();
    });
});

describe("services/roster/rosterRoleSync reconcile", () => {
    const run = (list) => {
        discord.fetchGuildMembersCached.mockResolvedValueOnce(list);
        return sync.reconcile("g1");
    };

    it("adds every holder who is no member, and keeps members who never held the role", async () => {
        rosterStore.upsertMember(roster.id, "100009", {}); // e.g. from the migration, no role
        const res = await run([member("100001", ["main"]), member("100002", ["alt"]), member("100003", ["other"]), member("100004", ["main"], { bot: true })]);
        expect(res).toEqual(expect.objectContaining({ added: 2, removed: 0, error: null }));
        expect(Object.keys(fresh().members).sort()).toEqual(["100001", "100002", "100009"]);
        expect(sync.lastReconcile("g1")).toEqual(res);
    });

    it("is idempotent: a second run changes nothing", async () => {
        const list = [member("100001", ["main"]), member("100002", ["alt"])];
        await run(list);
        const lines = fresh().history.length;
        const res = await run(list);
        expect(res).toEqual(expect.objectContaining({ added: 0, removed: 0 }));
        expect(fresh().history).toHaveLength(lines);
    });

    it("removes only a member it saw holding a role last time who holds none now", async () => {
        rosterStore.upsertMember(roster.id, "100009", {});
        await run([member("100001", ["main"]), member("100002", ["main"])]);
        const res = await run([member("100001", ["main"]), member("100002", [])]);
        expect(res.removed).toBe(1);
        expect(Object.keys(fresh().members).sort()).toEqual(["100001", "100009"]);
    });

    it("a failed or empty member fetch changes nothing", async () => {
        rosterStore.upsertMember(roster.id, "100001", {});
        await run([member("100001", ["main"])]);
        discord.fetchGuildMembersCached.mockRejectedValueOnce(new Error("Missing intent"));
        expect((await sync.reconcile("g1")).error).toBe("Missing intent");
        expect((await run([])).skipped).toBe("no_members");
        expect(fresh().members["100001"]).toBeTruthy();
        // and the snapshot survived: the next real list still compares against it
        expect((await run([member("100001", ["main"])])).removed).toBe(0);
    });

    it("skips offline servers, servers without rosters, and a run already going", async () => {
        discord.isOnline.mockReturnValueOnce(false);
        expect((await sync.reconcile("g1")).skipped).toBe("offline");
        expect((await sync.reconcile("g9")).skipped).toBe("no_rosters");
        expect((await sync.reconcile("")).skipped).toBe("no_guild");
        let release;
        discord.fetchGuildMembersCached.mockImplementationOnce(() => new Promise((r) => { release = r; }));
        const first = sync.reconcile("g1");
        expect((await sync.reconcile("g1")).skipped).toBe("running");
        release([]);
        await first;
    });

    it("the tool's own recent write wins over a stale cached member list (no loop)", async () => {
        await run([member("100001", ["main"])]);
        // the tool removed 100001 and took the role; the cached list still shows the role
        rosterStore.removeMember(roster.id, "100001", { actor: "o1" });
        memberRoles.recentWrite.mockImplementation((g, u, r) => (u === "100001" && r === "main" ? false : undefined));
        const res = await run([member("100001", ["main"])]);
        expect(res.added).toBe(0);
        expect(fresh().members["100001"]).toBeUndefined();
    });

    it("does not add back a holder whose role the tool failed to take", async () => {
        rosterStore.upsertMember(roster.id, "100001", {});
        rosterStore.removeMember(roster.id, "100001", { actor: "o1" });
        rosterStore.appendHistory(roster.id, { userId: "100001", what: "role-take-failed", detail: "x" });
        expect((await run([member("100001", ["main"])])).added).toBe(0);
    });

    it("skips removals for one run after the roster's roles changed", async () => {
        await run([member("100001", ["main"])]);
        rosterStore.updateRoster(roster.id, { roleIds: ["alt"] });
        expect((await run([member("100001", ["main"])])).removed).toBe(0);
        expect(fresh().members["100001"]).toBeTruthy();
        expect((await run([member("100001", ["main"])])).removed).toBe(0); // never held "alt" in a snapshot
    });

    it("leaves a roster alone whose roles were all deleted on the server", async () => {
        await run([member("100001", ["main"]), member("100002", ["alt"])]);
        discord.getGuild.mockReturnValueOnce({ id: "g1", roles: { cache: new Map([["other", {}]]) } });
        const res = await run([member("100001", []), member("100002", [])]);
        expect(res.removed).toBe(0);
        expect(Object.keys(fresh().members)).toHaveLength(2);
    });

    it("holds back a mass removal (more than half, at least 5) and logs it instead", async () => {
        const ids = ["100001", "100002", "100003", "100004", "100005", "100006"];
        await run(ids.map((id) => member(id, ["main"])));
        const res = await run(ids.map((id, i) => member(id, i === 0 ? ["main"] : [])));
        expect(res.removed).toBe(0);
        expect(res.held).toEqual([{ rosterId: roster.id, count: 5 }]);
        expect(Object.keys(fresh().members)).toHaveLength(6);
    });

    it("pause members keep their place as long as they hold the role", async () => {
        rosterStore.upsertMember(roster.id, "100001", { status: "pause" });
        await run([member("100001", ["main"])]);
        expect((await run([member("100001", ["main"])])).removed).toBe(0);
        expect(fresh().members["100001"].status).toBe("pause");
    });

    it("reconcileAll runs every server that has a roster with roles", async () => {
        rosterStore.createRoster({ name: "Zwei", guildId: "g2", roleIds: ["x"] });
        rosterStore.createRoster({ name: "Ohne Rollen", guildId: "g3" });
        const res = await sync.reconcileAll();
        expect(res.map((r) => r.guildId).sort()).toEqual(["g1", "g2"]);
    });
});

describe("services/roster/rosterRoleSync scheduler", () => {
    afterEach(() => jest.useRealTimers());

    it("runs a minute after start and every 10 minutes, idempotent and stoppable", async () => {
        jest.useFakeTimers();
        const t1 = sync.startRosterRoleSync();
        expect(sync.startRosterRoleSync()).toBe(t1);
        jest.advanceTimersByTime(60 * 1000);
        expect(discord.fetchGuildMembersCached).toHaveBeenCalledTimes(1);
        sync.stopRosterRoleSync();
        sync.stopRosterRoleSync();
        jest.advanceTimersByTime(20 * 60 * 1000);
        expect(discord.fetchGuildMembersCached).toHaveBeenCalledTimes(1);
    });
});

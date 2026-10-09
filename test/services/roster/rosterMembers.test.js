// rosterMembers (#656): store write first, then the roles - the base for the
// member routes of #655.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/services/roster/rosterRoleSync", () => ({
    applyMemberAdded: jest.fn(async () => ({ ok: true, results: [{ roleId: "main", give: true, ok: true, code: "done", changed: true }] })),
    applyMemberRemoved: jest.fn(async () => ({ ok: true, results: [] })),
    applyStatusChange: jest.fn(async () => ({ ok: true, skipped: "no_roles", results: [] })),
}));

const fs = require("fs");
const rosterStore = require("../../../src/stores/rosterStore");
const rosterRoleSync = require("../../../src/services/roster/rosterRoleSync");
const { addMember, removeMember, setStatus } = require("../../../src/services/roster/rosterMembers");

let roster;
beforeEach(() => {
    fs.__store.clear();
    jest.clearAllMocks();
    roster = rosterStore.createRoster({ name: "Donnerstag", guildId: "g1", roleIds: ["main"], trialRoleId: "trial" });
});
const fresh = () => rosterStore.getRoster(roster.id);

describe("services/roster/rosterMembers addMember", () => {
    it("writes the member first, then gives the roles, and hands both back", async () => {
        rosterRoleSync.applyMemberAdded.mockImplementationOnce(async (id, uid) => {
            // the store already has them when the role goes out (no loop)
            expect(rosterStore.getRoster(id).members[uid]).toBeTruthy();
            return { ok: true, results: [] };
        });
        const res = await addMember(roster.id, "100001", { status: "trial", chars: ["Devi"] }, { actor: "o1" });
        expect(res.ok).toBe(true);
        expect(res.member).toEqual(expect.objectContaining({ status: "trial", chars: ["devi"] }));
        expect(rosterRoleSync.applyMemberAdded).toHaveBeenCalledWith(roster.id, "100001", { actor: "o1" });
    });

    it("refuses unknown rosters, bad ids, bad status and existing members", async () => {
        expect((await addMember("nope", "100001")).code).toBe("not_found");
        expect((await addMember(roster.id, "abc")).code).toBe("bad_request");
        expect((await addMember(roster.id, "100001", { status: "boss" })).code).toBe("invalid_status");
        await addMember(roster.id, "100001");
        expect((await addMember(roster.id, "100001")).code).toBe("already_member");
        expect(rosterRoleSync.applyMemberAdded).toHaveBeenCalledTimes(1);
    });

    it("answers the store's limit as a code", async () => {
        const spy = jest.spyOn(rosterStore, "upsertMember").mockImplementationOnce(() => { throw new rosterStore.RosterError("member_limit"); });
        expect((await addMember(roster.id, "100001")).code).toBe("member_limit");
        expect(rosterRoleSync.applyMemberAdded).not.toHaveBeenCalled();
        spy.mockImplementationOnce(() => { throw new Error("disk"); });
        await expect(addMember(roster.id, "100001")).rejects.toThrow("disk");
        spy.mockRestore();
    });
});

describe("services/roster/rosterMembers removeMember", () => {
    it("removes from the store first, then takes the roles", async () => {
        rosterStore.upsertMember(roster.id, "100001", {});
        rosterRoleSync.applyMemberRemoved.mockImplementationOnce(async (id, uid) => {
            expect(rosterStore.getRoster(id).members[uid]).toBeUndefined();
            return { ok: false, results: [{ roleId: "main", give: false, ok: false, code: "no_permission", changed: false }] };
        });
        const res = await removeMember(roster.id, "100001", { actor: "o1" });
        expect(res.ok).toBe(true);
        expect(res.roles.ok).toBe(false);
        expect(fresh().history.slice(-1)[0]).toEqual(expect.objectContaining({ what: "member-removed", by: "o1" }));
    });

    it("refuses a non-member", async () => {
        expect((await removeMember(roster.id, "100001")).code).toBe("not_member");
        expect(rosterRoleSync.applyMemberRemoved).not.toHaveBeenCalled();
    });
});

describe("services/roster/rosterMembers setStatus", () => {
    it("changes the status, then moves the trial role with from/to", async () => {
        rosterStore.upsertMember(roster.id, "100001", {});
        const res = await setStatus(roster.id, "100001", "trial", { actor: "o1" });
        expect(res.member.status).toBe("trial");
        expect(rosterRoleSync.applyStatusChange).toHaveBeenCalledWith(roster.id, "100001", "core", "trial", { actor: "o1" });
    });

    it("does nothing for the same status, refuses bad ones and non-members", async () => {
        rosterStore.upsertMember(roster.id, "100001", { status: "pause" });
        expect((await setStatus(roster.id, "100001", "pause")).ok).toBe(true);
        expect((await setStatus(roster.id, "100001", "boss")).code).toBe("invalid_status");
        expect((await setStatus(roster.id, "100002", "core")).code).toBe("not_member");
        expect((await setStatus("nope", "100001", "core")).code).toBe("not_found");
        expect(rosterRoleSync.applyStatusChange).not.toHaveBeenCalled();
    });
});

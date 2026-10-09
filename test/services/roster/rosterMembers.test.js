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
const raiderProfileStore = require("../../../src/stores/raiderProfileStore");
const { addMember, updateMember, removeMember, setStatus, cleanPatch } = require("../../../src/services/roster/rosterMembers");

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

describe("services/roster/rosterMembers characters (#655)", () => {
    beforeEach(() => {
        raiderProfileStore.addCharacter("100001", { name: "Devi", className: "Priest", specs: ["Priest-Holy"] });
        raiderProfileStore.addCharacter("100001", { name: "Keslight", className: "Mage", specs: ["Mage-Frost"] });
    });

    it("gives a new member the first profile character of the roster's version", async () => {
        const res = await addMember(roster.id, "100001", { status: "core" });
        expect(res.member).toEqual(expect.objectContaining({ chars: ["devi"], charNames: { devi: "Devi" } }));
        expect(fresh().history.slice(-1)[0]).toEqual(expect.objectContaining({ what: "member-added", userId: "100001" }));
    });

    it("takes a profile key, keeps the profile's spelling and refuses a second without allowMultipleChars", async () => {
        const res = await addMember(roster.id, "100001", { chars: ["keslight"] }, { actor: "o1" });
        expect(res.member.charNames).toEqual({ keslight: "Keslight" });
        const second = await updateMember(roster.id, "100001", { chars: ["keslight", "devi"] }, { actor: "o1" });
        expect(second).toEqual(expect.objectContaining({ ok: false, code: "single_char_only" }));
        expect(fresh().members["100001"].chars).toEqual(["keslight"]);
    });

    it("keeps a name typed by hand and reorders with allowMultipleChars", async () => {
        const multi = rosterStore.createRoster({ name: "PuG", guildId: "g1", allowMultipleChars: true });
        await addMember(multi.id, "100001", { chars: ["devi", "Fremdname"] });
        const res = await updateMember(multi.id, "100001", { chars: ["fremdname", "devi"] }, { actor: "o1" });
        expect(res.member.chars).toEqual(["fremdname", "devi"]);
        expect(res.member.charNames).toEqual({ fremdname: "Fremdname", devi: "Devi" });
        expect(rosterStore.getRoster(multi.id).history.slice(-1)[0])
            .toEqual(expect.objectContaining({ what: "member", by: "o1", detail: "chars fremdname, devi" }));
    });

    it("maps a Forever roster's characters onto that version's keys", async () => {
        raiderProfileStore.addCharacter("100002", { name: "Aldric Sturmwind", className: "Warrior", specs: ["Warrior-Fury"], versionId: "forever" });
        const forever = rosterStore.createRoster({ name: "Forever", guildId: "g1", versionId: "forever" });
        const res = await addMember(forever.id, "100002", {});
        expect(res.member.chars).toEqual(["forever~aldric sturmwind"]);
        expect(res.member.charNames["forever~aldric sturmwind"]).toBe("Aldric Sturmwind");
    });
});

describe("services/roster/rosterMembers updateMember", () => {
    beforeEach(() => rosterStore.upsertMember(roster.id, "100001", { status: "trial" }));

    it("changes status, note and trial end in one history line and moves the trial role", async () => {
        const res = await updateMember(roster.id, "100001", { status: "core", note: "  Gute Raids  ", trialUntil: "2026-11-01" }, { actor: "o1" });
        expect(res.ok).toBe(true);
        expect(res.member).toEqual(expect.objectContaining({ status: "core", note: "Gute Raids", trialUntil: "2026-11-01T00:00:00.000Z", by: "o1" }));
        expect(rosterRoleSync.applyStatusChange).toHaveBeenCalledWith(roster.id, "100001", "trial", "core", { actor: "o1" });
        const last = fresh().history.slice(-1)[0];
        expect(last).toEqual(expect.objectContaining({ what: "member", by: "o1" }));
        expect(last.detail).toContain("status trial → core");
    });

    it("touches no role without a status change and clears the trial end with null", async () => {
        await updateMember(roster.id, "100001", { trialUntil: "2026-11-01" });
        const res = await updateMember(roster.id, "100001", { trialUntil: null });
        expect(res.member.trialUntil).toBeNull();
        expect(rosterRoleSync.applyStatusChange).not.toHaveBeenCalled();
    });

    it("answers an empty patch with the member as it is", async () => {
        const before = fresh().history.length;
        const res = await updateMember(roster.id, "100001", {});
        expect(res).toEqual(expect.objectContaining({ ok: true, member: expect.objectContaining({ status: "trial" }) }));
        expect(fresh().history).toHaveLength(before);
    });

    it("refuses bad input with a code", async () => {
        const cases = [
            [{ status: "boss" }, "invalid_status"],
            [{ note: "x".repeat(501) }, "note_too_long"],
            [{ note: 5 }, "bad_request"],
            [{ trialUntil: "morgen" }, "invalid_date"],
            [{ trialUntil: {} }, "invalid_date"],
            [{ chars: "devi" }, "invalid_chars"],
            [{ chars: [""] }, "invalid_chars"],
            [{ chars: ["x".repeat(65)] }, "invalid_chars"],
        ];
        for (const [patch, code] of cases) expect({ patch, code: (await updateMember(roster.id, "100001", patch)).code }).toEqual({ patch, code });
        expect((await updateMember(roster.id, "100009", {})).code).toBe("not_member");
        expect((await updateMember("nope", "100001", {})).code).toBe("not_found");
    });

    it("cleanPatch leaves out what was not sent", () => {
        expect(cleanPatch(fresh(), "100001", { note: "" })).toEqual({ patch: { note: "" } });
        expect(cleanPatch(fresh(), "100001", null)).toEqual({ patch: {} });
    });
});

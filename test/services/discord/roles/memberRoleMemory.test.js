// The member's roles for the raider's lists, with a short memory over a Discord
// hiccup (src/services/discord/roles/memberRoleMemory.js).
jest.mock("../../../../src/services/discord/discord", () => ({ memberRoleIds: jest.fn() }));

const discord = require("../../../../src/services/discord/discord");
const { memberRolesRemembered, KEEP_MS, _resetForTests } = require("../../../../src/services/discord/roles/memberRoleMemory");

const NOW = 1_900_000_000_000;

beforeEach(() => {
    _resetForTests();
    discord.memberRoleIds.mockReset();
});

describe("memberRolesRemembered", () => {
    it("reads the roles live and remembers them", async () => {
        discord.memberRoleIds.mockResolvedValue(["r1", 2]);
        expect(await memberRolesRemembered("g1", "u1", { now: NOW })).toEqual({ roleIds: ["r1", "2"], stale: false });
        expect(discord.memberRoleIds).toHaveBeenCalledWith("g1", "u1");
    });

    it("hands a time limit on to the read", async () => {
        discord.memberRoleIds.mockResolvedValue(["r1"]);
        await memberRolesRemembered("g1", "u1", { now: NOW, waitMs: 250 });
        expect(discord.memberRoleIds).toHaveBeenCalledWith("g1", "u1", { waitMs: 250 });
    });

    describe("absentAs: Discord surely knows no such member", () => {
        /** What discord.memberRoleIds does on Unknown Member: hands back the array it was given. */
        const noMember = async (_guildId, _userId, { absentAs = null } = {}) => absentAs;

        it("hands it on with the time limit and answers it, not as a stand-in", async () => {
            discord.memberRoleIds.mockImplementation(noMember);
            const absentAs = [];
            expect(await memberRolesRemembered("g1", "u1", { now: NOW, waitMs: 250, absentAs })).toEqual({ roleIds: [], stale: false });
            expect(discord.memberRoleIds).toHaveBeenCalledWith("g1", "u1", { absentAs, waitMs: 250 });
        });

        it("beats an older read, so a member who left holds nothing for this caller", async () => {
            discord.memberRoleIds.mockResolvedValueOnce(["r1"]);
            await memberRolesRemembered("g1", "u1", { now: NOW });
            discord.memberRoleIds.mockImplementation(noMember);
            expect(await memberRolesRemembered("g1", "u1", { now: NOW + 1000, absentAs: [] })).toEqual({ roleIds: [], stale: false });
        });

        it("stays out of the memory: the other callers still read unknown in an outage", async () => {
            discord.memberRoleIds.mockImplementationOnce(noMember);
            await memberRolesRemembered("g1", "u1", { now: NOW, absentAs: [] });
            discord.memberRoleIds.mockResolvedValue(null);
            expect(await memberRolesRemembered("g1", "u1", { now: NOW + 1000 })).toEqual({ roleIds: null, stale: false });
        });

        it("leaves an older read in the memory for the other callers", async () => {
            discord.memberRoleIds.mockResolvedValueOnce(["r1"]);
            await memberRolesRemembered("g1", "u1", { now: NOW });
            discord.memberRoleIds.mockImplementationOnce(noMember);
            await memberRolesRemembered("g1", "u1", { now: NOW + 1000, absentAs: [] });
            discord.memberRoleIds.mockResolvedValue(null);
            expect(await memberRolesRemembered("g1", "u1", { now: NOW + 2000 })).toEqual({ roleIds: ["r1"], stale: true });
        });

        it("still remembers a member who really holds no role", async () => {
            discord.memberRoleIds.mockResolvedValueOnce([]);
            expect(await memberRolesRemembered("g1", "u1", { now: NOW, absentAs: [] })).toEqual({ roleIds: [], stale: false });
            discord.memberRoleIds.mockResolvedValue(null);
            expect(await memberRolesRemembered("g1", "u1", { now: NOW + 1000 })).toEqual({ roleIds: [], stale: true });
        });

        it("stays unknown after a failed read", async () => {
            discord.memberRoleIds.mockResolvedValue(null);
            expect(await memberRolesRemembered("g1", "u1", { now: NOW, absentAs: [] })).toEqual({ roleIds: null, stale: false });
        });
    });

    it("stands in with the last read while it is young, then says unknown", async () => {
        discord.memberRoleIds.mockResolvedValueOnce(["r1"]);
        await memberRolesRemembered("g1", "u1", { now: NOW });
        discord.memberRoleIds.mockResolvedValue(null);
        expect(await memberRolesRemembered("g1", "u1", { now: NOW + 60_000 })).toEqual({ roleIds: ["r1"], stale: true });
        expect(await memberRolesRemembered("g1", "u1", { now: NOW + KEEP_MS })).toEqual({ roleIds: null, stale: false });
    });

    it("treats a throwing read like a failed one and keeps members apart", async () => {
        discord.memberRoleIds.mockResolvedValueOnce(["r1"]);
        await memberRolesRemembered("g1", "u1", { now: NOW });
        discord.memberRoleIds.mockRejectedValue(new Error("gateway down"));
        expect((await memberRolesRemembered("g1", "u1", { now: NOW + 1000 })).roleIds).toEqual(["r1"]);
        expect((await memberRolesRemembered("g1", "u2", { now: NOW + 1000 })).roleIds).toBeNull();
        expect((await memberRolesRemembered("g2", "u1", { now: NOW + 1000 })).roleIds).toBeNull();
    });

    it("asks nothing without a server or a member", async () => {
        expect(await memberRolesRemembered("", "u1")).toEqual({ roleIds: null, stale: false });
        expect(discord.memberRoleIds).not.toHaveBeenCalled();
    });
});

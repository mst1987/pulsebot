// Wer einen Abend von Hand setzen darf (#677): Admins, raids mit Schreibrecht, Manager des Rosters der Kategorie.
const mockRosterForCategory = jest.fn(() => null);
jest.mock("../../../src/stores/rosterStore", () => ({ rosterForCategory: (...a) => mockRosterForCategory(...a) }));

const { canEditAttendance, canEditAnyAttendance } = require("../../../src/services/characters/attendanceAccess");

const ROSTER = { guildId: "g1", managers: { userIds: ["m1"], roleIds: ["r9"] } };

describe("services/characters/attendanceAccess", () => {
    it("lässt Admins und raids-Schreiber überall zu, sonst niemanden ohne Roster", async () => {
        expect(canEditAnyAttendance(null)).toBe(false);
        expect(canEditAnyAttendance({ id: "1", isAdmin: true })).toBe(true);
        expect(canEditAnyAttendance({ id: "2", access: { raids: { read: true, write: true } } })).toBe(true);
        expect(canEditAnyAttendance({ id: "3", access: { raids: { read: true, write: false } } })).toBe(false);
        expect(await canEditAttendance({ id: "3", access: {} }, "cat")).toBe(false);
        expect(await canEditAttendance({ id: "3", access: {} }, "")).toBe(false);
        expect(await canEditAttendance(null, "cat")).toBe(false);
    });

    it("lässt Manager des Rosters der Kategorie zu — per Konto oder per Rolle", async () => {
        mockRosterForCategory.mockReturnValue(ROSTER);
        expect(await canEditAttendance({ id: "m1" }, "cat")).toBe(true);
        expect(mockRosterForCategory).toHaveBeenCalledWith("cat");
        expect(await canEditAttendance({ id: "x" }, "cat", { memberRoleIds: async () => ["r9"] })).toBe(true);
        expect(await canEditAttendance({ id: "x" }, "cat", { memberRoleIds: async () => [] })).toBe(false);
        expect(await canEditAttendance({ id: "x" }, "cat", { memberRoleIds: async () => { throw new Error("offline"); } })).toBe(false);
    });
});

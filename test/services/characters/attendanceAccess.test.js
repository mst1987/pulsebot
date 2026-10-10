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
        // without a version: the one the category plays now
        expect(mockRosterForCategory).toHaveBeenCalledWith("cat", "tbc");
        expect(await canEditAttendance({ id: "x" }, "cat", { memberRoleIds: async () => ["r9"] })).toBe(true);
        expect(await canEditAttendance({ id: "x" }, "cat", { memberRoleIds: async () => [] })).toBe(false);
        expect(await canEditAttendance({ id: "x" }, "cat", { memberRoleIds: async () => { throw new Error("offline"); } })).toBe(false);
    });

    it("nimmt das Roster der Version des Abends; ein abgeschlossenes gibt kein Recht (#739)", async () => {
        mockRosterForCategory.mockImplementation((cat, version) => (version === "forever" ? ROSTER : { ...ROSTER, closedAt: "2026-10-01T00:00:00.000Z" }));
        expect(await canEditAttendance({ id: "m1" }, "cat", { versionId: "forever" })).toBe(true);
        expect(mockRosterForCategory).toHaveBeenLastCalledWith("cat", "forever");
        expect(await canEditAttendance({ id: "m1" }, "cat", { versionId: "tbc" })).toBe(false);
        // admins and raids write stay free
        expect(await canEditAttendance({ id: "a", isAdmin: true }, "cat", { versionId: "tbc" })).toBe(true);
    });
});

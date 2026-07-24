const { computeAttendance } = require("../../src/utils/attendance");

describe("utils/attendance computeAttendance", () => {
    const members = [
        { id: "1", displayName: "Alice" },
        { id: "2", displayName: "Bob" },
        { id: "3", displayName: "Cara" },
    ];

    it("splits members into responded and missing by signup userId", () => {
        const signUps = [{ userId: "1", specName: "Warrior" }];
        const { responded, missing } = computeAttendance(members, signUps);
        expect(responded.map((m) => m.id)).toEqual(["1"]);
        expect(missing.map((m) => m.id)).toEqual(["2", "3"]);
    });

    it("counts an Absence (signed off) as reacted, not missing", () => {
        const signUps = [{ userId: "2", specName: "Absence" }];
        const { responded, missing } = computeAttendance(members, signUps);
        expect(responded.map((m) => m.id)).toEqual(["2"]);
        expect(missing.map((m) => m.id)).toEqual(["1", "3"]);
    });

    it("treats everyone as missing when there are no signups", () => {
        const { responded, missing } = computeAttendance(members, []);
        expect(responded).toEqual([]);
        expect(missing).toHaveLength(3);
    });

    it("ignores signups without a userId and members without an id", () => {
        const { responded, missing } = computeAttendance(
            [...members, { displayName: "NoId" }],
            [{ specName: "Warrior" }, { userId: "3" }]
        );
        expect(responded.map((m) => m.id)).toEqual(["3"]);
        expect(missing.map((m) => m.id)).toEqual(["1", "2"]);
    });

    it("returns empty splits for empty/omitted inputs", () => {
        expect(computeAttendance()).toEqual({ responded: [], missing: [] });
        expect(computeAttendance([], [])).toEqual({ responded: [], missing: [] });
    });
});

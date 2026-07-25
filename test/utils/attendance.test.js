const { computeAttendance, buildSpecHistory, withSpecProfiles } = require("../../src/utils/attendance");

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

describe("utils/attendance buildSpecHistory", () => {
    it("keeps the most recent real spec per user across events", () => {
        const events = [
            { startTime: 100, signUps: [{ userId: "1", specName: "Fury" }] },
            { startTime: 300, signUps: [{ userId: "1", specName: "Arms" }] },
            { startTime: 200, signUps: [{ userId: "1", specName: "Protection" }] },
        ];
        expect(buildSpecHistory(events)).toEqual({ 1: "Arms" });
    });

    it("skips Absence entries and signups without a spec or userId", () => {
        const events = [
            { startTime: 100, signUps: [{ userId: "1", specName: "Absence" }, { userId: "2" }, { specName: "Fury" }] },
        ];
        expect(buildSpecHistory(events)).toEqual({});
    });

    it("falls back to an older spec when the most recent event has none for that user", () => {
        const events = [
            { startTime: 200, signUps: [{ userId: "2", specName: "Shadow" }] },
            { startTime: 100, signUps: [{ userId: "1", specName: "Fury" }] },
        ];
        expect(buildSpecHistory(events)).toEqual({ 1: "Fury", 2: "Shadow" });
    });

    it("returns {} for empty/omitted input", () => {
        expect(buildSpecHistory()).toEqual({});
        expect(buildSpecHistory([])).toEqual({});
    });
});

describe("utils/attendance withSpecProfiles", () => {
    const specHistory = { 1: "Fury", 2: "UnknownSpec" };

    it("attaches a class/spec profile to members with a known spec", () => {
        const [alice] = withSpecProfiles([{ id: "1", displayName: "Alice" }], specHistory);
        expect(alice.displayName).toBe("Alice");
        expect(alice.profile).toMatchObject({ specName: "Fury Warrior", className: "Warrior", classColor: "#C79C6E" });
    });

    it("leaves members without history or with an unrecognised spec unchanged", () => {
        const people = withSpecProfiles(
            [{ id: "2", displayName: "Bob" }, { id: "3", displayName: "Cara" }],
            specHistory
        );
        expect(people[0]).toEqual({ id: "2", displayName: "Bob" });
        expect(people[1]).toEqual({ id: "3", displayName: "Cara" });
    });

    it("passes through malformed entries and defaults specHistory to {}", () => {
        expect(withSpecProfiles([null, { displayName: "NoId" }])).toEqual([null, { displayName: "NoId" }]);
        expect(withSpecProfiles()).toEqual([]);
    });
});

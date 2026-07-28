const {
    computeAttendance, buildSpecHistory, withSpecProfiles, withCharacterAssignments,
    hasStarted, isRosterKnown,
} = require("../../src/utils/attendance");

describe("utils/attendance hasStarted / isRosterKnown", () => {
    const NOW = 1_700_000_000_000;
    const secs = (ms) => Math.floor(ms / 1000);
    const past = { startTime: secs(NOW - 3 * 3600000) };
    const upcoming = { startTime: secs(NOW + 3 * 3600000) };

    it("recognises a started raid, and treats a missing start as upcoming", () => {
        expect(hasStarted(past, NOW)).toBe(true);
        expect(hasStarted(upcoming, NOW)).toBe(false);
        expect(hasStarted({}, NOW)).toBe(false);
        expect(hasStarted(null, NOW)).toBe(false);
    });

    it("treats an empty roster on an UPCOMING raid as a real answer", () => {
        // Nobody has reacted yet — that is knowledge, not a gap.
        expect(isRosterKnown({ ...upcoming, signUps: [] }, NOW)).toBe(true);
    });

    // The regression this exists for: Raid-Helper drops a finished raid's
    // signups, and the detail page then reported "0 Anmeldungen" plus every
    // expected raider as missing.
    it("treats an empty roster on a PAST raid as unknown", () => {
        expect(isRosterKnown({ ...past, signUps: [] }, NOW)).toBe(false);
        expect(isRosterKnown(past, NOW)).toBe(false);
    });

    it("counts any roster as known, past or not", () => {
        const signUps = [{ userId: "1", specName: "Fury" }];
        expect(isRosterKnown({ ...past, signUps }, NOW)).toBe(true);
        expect(isRosterKnown({ ...upcoming, signUps }, NOW)).toBe(true);
    });
});

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

describe("utils/attendance withCharacterAssignments", () => {
    it("attaches the assigned character name and an overriding profile", () => {
        const people = [{ id: "1", displayName: "Sedroc", profile: { specName: "Fury Warrior", className: "Warrior" } }];
        const assignments = { 1: { character: "Elesham", className: "Shaman", spec: "Elemental" } };
        const [sedroc] = withCharacterAssignments(people, assignments);
        expect(sedroc.character).toBe("Elesham");
        expect(sedroc.profile).toMatchObject({ specName: "Elemental", className: "Shaman" });
    });

    it("keeps the character name but falls back to the old profile when the class is unknown", () => {
        const people = [{ id: "1", displayName: "Sedroc", profile: { specName: "Fury Warrior", className: "Warrior" } }];
        const assignments = { 1: { character: "Elesham" } };
        const [sedroc] = withCharacterAssignments(people, assignments);
        expect(sedroc.character).toBe("Elesham");
        expect(sedroc.profile).toMatchObject({ className: "Warrior" });
    });

    it("leaves members without an assignment unchanged", () => {
        const people = [{ id: "2", displayName: "Bob" }];
        expect(withCharacterAssignments(people, { 1: { character: "Elesham", className: "Shaman" } })).toEqual(people);
    });

    it("passes through malformed entries and defaults assignmentProfiles to {}", () => {
        expect(withCharacterAssignments([null, { displayName: "NoId" }])).toEqual([null, { displayName: "NoId" }]);
        expect(withCharacterAssignments()).toEqual([]);
    });
});

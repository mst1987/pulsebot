// The row dialog (AssignModal.tsx) wires the class counts and the general tanks; the logic of lib/classRefs.ts is tested in
// src/web-client/src/lib/classCount.test.ts.
const fs = require("fs");
const path = require("path");

describe("the row dialog", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../../src/web-client/src/pages/raid-detail/raidplan/AssignModal.tsx"), "utf8");
    it("shows the general tanks on tanking rows and edits counts through setClassCount", () => {
        expect(src).toMatch(/TANK_TYPES\.indexOf\(type\)/);
        expect(src).toMatch(/TANK_CLASSES\.map/);
        expect(src).toMatch(/setClassCount\(/);
        expect(src).toMatch(/candidatesOf\(/);
    });
    it("one card per class with a count stepper (- n +), a role filter and a remove", () => {
        expect(src).toMatch(/classGroups\(own\)/);
        expect(src).toMatch(/setCount\(g\.classId, g\.role, g\.refs\.length - 1, target\)/);
        expect(src).toMatch(/setCount\(g\.classId, g\.role, g\.refs\.length \+ 1, target\)/);
        expect(src).toMatch(/setCount\(g\.classId, g\.role, 0, target\)/);
        expect(src).toMatch(/setClassRole\(/);
    });
});

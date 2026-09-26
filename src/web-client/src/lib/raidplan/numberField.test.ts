// What a typed number becomes in the raid plan's number fields (lib/numberField.ts).
import { describe, expect, it } from "vitest";
import * as nf from "./numberField";

describe("clampNumber", () => {
    it("keeps a value inside the range and rounds it", () => {
        expect(nf.clampNumber(150, 10, 100)).toBe(100);
        expect(nf.clampNumber(-5, 10, 100)).toBe(10);
        expect(nf.clampNumber(47.6, 10, 100)).toBe(48);
        expect(nf.clampNumber(1.234, 0.5, 2, 2)).toBe(1.23);
    });
});

describe("parseNumberText", () => {
    it("reads a number and clamps it: 150 in a field up to 100 is 100", () => {
        expect(nf.parseNumberText("150", 10, 100, 50)).toBe(100);
        expect(nf.parseNumberText("5", 10, 100, 50)).toBe(10);
        expect(nf.parseNumberText("  64 ", 10, 100, 50)).toBe(64);
    });
    it("an empty or unreadable text is the last valid value, never NaN or zero", () => {
        for (const bad of ["", "   ", "-", "+", ".", "abc", "%", null, undefined]) expect(nf.parseNumberText(bad as string, 10, 100, 50)).toBe(50);
    });
    it("ignores a unit the user typed and takes a comma as the decimal point", () => {
        expect(nf.parseNumberText("80 %", 10, 100, 50)).toBe(80);
        expect(nf.parseNumberText("48px", 20, 200, 48)).toBe(48);
        expect(nf.parseNumberText("1,5", 0.5, 2, 1, 1)).toBe(1.5);
        expect(nf.parseNumberText("-20", -180, 180, 0)).toBe(-20);
    });
});

describe("formatNumber and stepNumber", () => {
    it("shows whole numbers plainly and nothing for a value that is no number", () => {
        expect(nf.formatNumber(64)).toBe("64");
        expect(nf.formatNumber(63.6)).toBe("64");
        expect(nf.formatNumber(1.25, 2)).toBe("1.25");
        expect(nf.formatNumber(NaN)).toBe("");
    });
    it("the arrow keys step by one, Shift by ten steps, and stop at the ends", () => {
        expect(nf.stepNumber(50, 1, 1, false, 10, 100)).toBe(51);
        expect(nf.stepNumber(50, -1, 5, false, 10, 100)).toBe(45);
        expect(nf.stepNumber(50, 1, 5, true, 10, 100)).toBe(100);
        expect(nf.stepNumber(95, 1, 5, true, 10, 100)).toBe(100);
        expect(nf.stepNumber(12, -1, 1, true, 10, 100)).toBe(10);
    });
});

import { describe, expect, it } from "vitest";
import { contrastRatio, readableOn, roleColorVars, roleTextColors } from "./roleColor";

describe("contrastRatio", () => {
    it("is 21 for black on white and 1 for a colour on itself", () => {
        expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
        expect(contrastRatio("#3498db", "#3498db")).toBeCloseTo(1, 5);
    });
});

describe("roleTextColors", () => {
    it("darkens a pale yellow for the light theme and keeps it for the dark one", () => {
        const c = roleTextColors("#f1c40f")!;
        expect(c.light).not.toBe("#f1c40f");
        expect(contrastRatio(c.light, "#ffffff")).toBeGreaterThanOrEqual(4.5);
        expect(c.dark).toBe("#f1c40f");
    });

    it("lightens a dark blue for the dark theme and keeps it for the light one", () => {
        const c = roleTextColors("#1f3a93")!;
        expect(c.light).toBe("#1f3a93");
        expect(c.dark).not.toBe("#1f3a93");
        expect(contrastRatio(c.dark, "#17181a")).toBeGreaterThanOrEqual(4.5);
    });

    it("has no variants without a colour", () => {
        expect(roleTextColors("")).toBeNull();
        expect(roleTextColors("nonsense")).toBeNull();
        expect(readableOn("nonsense", "#ffffff", "black")).toBe("");
    });
});

describe("roleColorVars", () => {
    it("names the real colour and both text variants under the prefix", () => {
        const v = roleColorVars("drl", "#f1c40f")!;
        expect(v["--drl-color"]).toBe("#f1c40f");
        expect(v["--drl-color-light"]).toBe(roleTextColors("#f1c40f")!.light);
        expect(v["--drl-color-dark"]).toBe("#f1c40f");
        expect(roleColorVars("dmb", "")).toBeUndefined();
    });
});

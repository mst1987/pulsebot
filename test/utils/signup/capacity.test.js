const {
    OVERFLOW_MODES, DEFAULT_OVERFLOW, normalizeOverflow, isLegacyOverflow, normalizeLockAtLimit, seatsText,
} = require("../../../src/utils/signup/capacity");

describe("utils/signup/capacity (#516)", () => {
    it("knows three modes, 'none' by default", () => {
        expect(OVERFLOW_MODES).toEqual(["none", "waitlist", "refuse"]);
        expect(DEFAULT_OVERFLOW).toBe("none");
    });

    it("normalizeOverflow keeps the modes and reads everything else, the legacy values included, as 'none'", () => {
        expect(normalizeOverflow("waitlist")).toBe("waitlist");
        expect(normalizeOverflow("refuse")).toBe("refuse");
        expect(normalizeOverflow("none")).toBe("none");
        for (const v of ["bench", "off", undefined, null, "", 3]) expect(normalizeOverflow(v)).toBe("none");
    });

    it("isLegacyOverflow spots the values from before #516", () => {
        expect(isLegacyOverflow("bench")).toBe(true);
        expect(isLegacyOverflow("off")).toBe(true);
        for (const v of ["none", "waitlist", "refuse", undefined]) expect(isLegacyOverflow(v)).toBe(false);
    });

    it("normalizeLockAtLimit is off on a legacy record and follows the flag otherwise", () => {
        expect(normalizeLockAtLimit({ overflow: "bench", lockAtLimit: true })).toBe(false);
        expect(normalizeLockAtLimit({ overflow: "off", lockAtLimit: true })).toBe(false);
        expect(normalizeLockAtLimit({ overflow: "waitlist", lockAtLimit: true })).toBe(true);
        expect(normalizeLockAtLimit({ lockAtLimit: true })).toBe(true);
        expect(normalizeLockAtLimit({ overflow: "none", lockAtLimit: "yes" })).toBe(false);
        expect(normalizeLockAtLimit(null)).toBe(false);
    });

    it("seatsText writes the fill, the overbooking as (+n)", () => {
        expect(seatsText(22, 25)).toBe("22/25");
        expect(seatsText(25, 25)).toBe("25/25");
        expect(seatsText(28, 25)).toBe("25/25 (+3)");
        expect(seatsText(28, 25, { sep: " / " })).toBe("25 / 25 (+3)");
        expect(seatsText(12, 0)).toBe("12");
        expect(seatsText(undefined, undefined)).toBe("0");
    });
});

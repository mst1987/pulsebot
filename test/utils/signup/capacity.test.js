const {
    OVERFLOW_MODES, DEFAULT_OVERFLOW, normalizeOverflow, isLegacyOverflow, normalizeLockAtLimit,
    ATTENDING_STATUSES, accountCount, signedUpText,
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

    describe("accountCount (#520)", () => {
        it("counts every Discord account once, however many characters it signed up", () => {
            const signups = [
                { userId: "1", status: "signed", characters: [{ character: "A" }, { character: "A2" }] },
                // Raid-Helper can hold two entries of one user
                { userId: "2", status: "signed" },
                { userId: "2", status: "late" },
                { userId: "3", status: "late" },
            ];
            expect(accountCount(signups)).toBe(3);
        });

        it("counts Dabei and Spät only — tentative, bench and absence stay out", () => {
            const signups = ["signed", "late", "tentative", "bench", "absence"].map((status, i) => ({ userId: String(i), status }));
            expect(accountCount(signups)).toBe(2);
            expect(ATTENDING_STATUSES).toEqual(["signed", "late"]);
        });

        it("reads a missing status as signed and a signup without user id as one of its own", () => {
            expect(accountCount([{ userId: "1" }, {}, {}, null])).toBe(3);
            expect(accountCount(undefined)).toBe(0);
        });

        it("takes a status reader for Raid-Helper entries", () => {
            const rh = [{ userId: "1", className: "Late" }, { userId: "2", className: "Absence" }];
            expect(accountCount(rh, (s) => (s.className === "Late" ? "late" : "absence"))).toBe(1);
        });
    });

    it("signedUpText writes the accounts alone — no /size (#520)", () => {
        expect(signedUpText(28, "en")).toBe("28 signed up");
        expect(signedUpText(0, "en")).toBe("0 signed up");
        expect(signedUpText(undefined, "en")).toBe("0 signed up");
        expect(signedUpText(-2, "en")).toBe("0 signed up");
    });

    it("signedUpText is German by default", () => {
        expect(signedUpText(28)).toBe("28 angemeldet");
        expect(signedUpText(3, "de")).toBe("3 angemeldet");
    });
});

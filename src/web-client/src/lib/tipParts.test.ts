// lib/tipParts.ts (#415): how a tooltip text splits into its bold head and its
// explanation. Moved out of components/ui/Tip.tsx so that file exports
// components only (react-refresh); the ui barrel still re-exports it.
import { describe, expect, it } from "vitest";
import { tipParts } from "./tipParts";

describe("tipParts", () => {
    it("keeps an explicit sub as it is", () => {
        expect(tipParts("Head", "More")).toEqual({ head: "Head", sub: "More" });
    });

    it("splits at the first line break", () => {
        expect(tipParts("Head\nfirst\nsecond", null)).toEqual({ head: "Head", sub: "first\nsecond" });
    });

    it("shows one long sentence as plain explanation", () => {
        const long = "x".repeat(61);
        expect(tipParts(long, null)).toEqual({ head: "", sub: long });
    });

    it("keeps a short tip as the head", () => {
        expect(tipParts("Short", null)).toEqual({ head: "Short", sub: "" });
    });
});

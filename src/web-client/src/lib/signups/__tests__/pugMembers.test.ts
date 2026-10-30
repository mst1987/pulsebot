import { describe, expect, it } from "vitest";
import { errorText, rovingIndex, safeInviteUrl } from "../pugMembers";

describe("safeInviteUrl (#907)", () => {
    it("passes only an https link", () => {
        expect(safeInviteUrl(" https://discord.gg/abc ")).toBe("https://discord.gg/abc");
        expect(safeInviteUrl("http://discord.gg/abc")).toBe("");
        expect(safeInviteUrl("javascript:alert(1)")).toBe("");
        expect(safeInviteUrl("https://")).toBe("");
        expect(safeInviteUrl(undefined)).toBe("");
        expect(safeInviteUrl(42)).toBe("");
    });
});

describe("errorText (#907)", () => {
    it("takes the message, a bare string, else the fallback", () => {
        expect(errorText({ code: "x", message: "Kaputt" }, "Fallback")).toBe("Kaputt");
        expect(errorText("Nur Text", "Fallback")).toBe("Nur Text");
        expect(errorText({ code: "x" }, "Fallback")).toBe("Fallback");
        expect(errorText({ message: "  " }, "Fallback")).toBe("Fallback");
        expect(errorText(null, "Fallback")).toBe("Fallback");
        expect(errorText(undefined, "Fallback")).toBe("Fallback");
    });
});

describe("rovingIndex (#907)", () => {
    it("moves with the arrows, wraps, jumps with Home/End", () => {
        expect(rovingIndex(0, 3, "ArrowRight")).toBe(1);
        expect(rovingIndex(2, 3, "ArrowDown")).toBe(0);
        expect(rovingIndex(0, 3, "ArrowLeft")).toBe(2);
        expect(rovingIndex(1, 3, "ArrowUp")).toBe(0);
        expect(rovingIndex(1, 3, "Home")).toBe(0);
        expect(rovingIndex(0, 3, "End")).toBe(2);
        expect(rovingIndex(0, 3, "Enter")).toBeNull();
        expect(rovingIndex(0, 0, "ArrowRight")).toBeNull();
    });
});

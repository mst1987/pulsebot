import { describe, expect, it } from "vitest";
import type { SetupSignupEdit } from "../../api";
import { initialPick, outsideProfile, pickChanged, pickCharacter, signupEditInput } from "./setupSignupEdit";

const spec = (key: string, role: "tank" | "healer" | "melee" | "ranged", inProfile: boolean) => ({ key, label: key, icon: "", role, inProfile, gear: "" });

/** Zibbo (shaman, enhancement in the profile) signed up with Zibbowar (warrior, protection) as the alternate. */
function data(over: Partial<SetupSignupEdit> = {}): SetupSignupEdit {
    return {
        userId: "u1",
        status: "bench",
        characters: [{ character: "Zibbo", spec: "Shaman-Enhancement", status: "bench" }, { character: "Zibbowar", spec: "Warrior-Protection", status: "bench" }],
        statuses: ["signed", "tentative", "late", "bench", "absence"],
        options: [
            { character: "Zibbo", key: "zibbo", classId: "Shaman", classLabel: "Schamane", classColor: "", classIcon: "", inProfile: true, specs: [spec("Shaman-Enhancement", "melee", true), spec("Shaman-Elemental", "ranged", false), spec("Shaman-Restoration", "healer", false)] },
            { character: "Zibbowar", key: "zibbowar", classId: "Warrior", classLabel: "Krieger", classColor: "", classIcon: "", inProfile: true, specs: [spec("Warrior-Protection", "tank", true), spec("Warrior-Arms", "melee", true), spec("Warrior-Fury", "melee", false)] },
            { character: "Heiltwink", key: "heiltwink", classId: "Priest", classLabel: "Priester", classColor: "", classIcon: "", inProfile: true, specs: [spec("Priest-Holy", "healer", true), spec("Priest-Shadow", "ranged", true)] },
        ],
        ...over,
    };
}

describe("setupSignupEdit", () => {
    it("starts on the character the setup shows, with the spec it is signed up with", () => {
        expect(initialPick(data(), "Zibbowar")).toEqual({ status: "bench", character: "Zibbowar", spec: "Warrior-Protection" });
        // a name the dialog does not know falls back to the signup's first character
        expect(initialPick(data(), "Niemand")).toEqual({ status: "bench", character: "Zibbo", spec: "Shaman-Enhancement" });
    });

    it("keeps the role where it can when another character is picked", () => {
        const start = initialPick(data(), "Zibbo");
        expect(pickCharacter(data(), start, "zibbowar").spec).toBe("Warrior-Protection");
        // not signed up with Heiltwink: a profile spec of the same role (ranged → shadow) wins over the first one
        expect(pickCharacter(data(), { ...start, spec: "Shaman-Elemental" }, "heiltwink").spec).toBe("Priest-Shadow");
        expect(pickCharacter(data(), start, "heiltwink").spec).toBe("Priest-Holy");
        expect(pickCharacter(data(), start, "unknown")).toBe(start);
    });

    it("knows a spec outside the profile and whether anything changed", () => {
        const start = initialPick(data(), "Zibbo");
        expect(outsideProfile(data(), start)).toBe(false);
        const elemental = { ...start, spec: "Shaman-Elemental" };
        expect(outsideProfile(data(), elemental)).toBe(true);
        expect(pickChanged(start, start)).toBe(false);
        expect(pickChanged(start, elemental)).toBe(true);
        expect(pickChanged(start, { ...start, status: "signed" })).toBe(true);
    });

    it("sends the replaced character as `from`, and no character with an absence", () => {
        const start = initialPick(data(), "Zibbo");
        expect(signupEditInput("u1", start, { status: "signed", character: "Zibbo", spec: "Shaman-Elemental" }))
            .toEqual({ userId: "u1", status: "signed", from: "Zibbo", character: "Zibbo", spec: "Shaman-Elemental" });
        expect(signupEditInput("u1", start, { ...start, status: "absence" })).toEqual({ userId: "u1", status: "absence", from: "Zibbo" });
    });
});

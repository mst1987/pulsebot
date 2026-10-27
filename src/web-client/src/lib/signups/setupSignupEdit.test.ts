import { describe, expect, it } from "vitest";
import type { SetupSignupEdit } from "../../api";
import { canSave, initialPick, optionOf, otherProblem, outsideProfile, pickChanged, pickCharacter, pickClass, pickOther, signupEditInput } from "./setupSignupEdit";

const spec = (key: string, role: "tank" | "healer" | "melee" | "ranged", inProfile: boolean) => ({ key, label: key, icon: "", role, inProfile, gear: "" });

const cs = (key: string, role: "tank" | "healer" | "melee" | "ranged") => ({ key, label: key, icon: "", role });

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
        classes: [
            { id: "Shaman", label: "Schamane", color: "", icon: "", specs: [cs("Shaman-Elemental", "ranged"), cs("Shaman-Enhancement", "melee"), cs("Shaman-Restoration", "healer")] },
            { id: "Mage", label: "Magier", color: "", icon: "", specs: [cs("Mage-Arcane", "ranged"), cs("Mage-Fire", "ranged"), cs("Mage-Frost", "ranged")] },
            { id: "Warrior", label: "Krieger", color: "", icon: "", specs: [cs("Warrior-Arms", "melee"), cs("Warrior-Fury", "melee"), cs("Warrior-Protection", "tank")] },
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

describe("setupSignupEdit: Anderer Charakter", () => {
    it("starts with an empty name on the class and spec of the current character", () => {
        const start = initialPick(data(), "Zibbo");
        const other = pickOther(data(), start);
        expect(other).toEqual({ status: "bench", other: true, character: "", className: "Shaman", spec: "Shaman-Enhancement" });
        expect(optionOf(data(), other)).toBeUndefined();
        expect(pickOther(data(), other)).toBe(other);
        // a class the rule set lacks: no class, no spec yet
        expect(pickOther(data({ classes: [] }), start)).toMatchObject({ className: "", spec: "" });
        // back to a known character drops the named one
        expect(pickCharacter(data(), other, "zibbowar")).toEqual({ status: "bench", character: "Zibbowar", spec: "Warrior-Protection" });
    });

    it("keeps the role when the class changes, else takes the class's first spec", () => {
        const other = pickOther(data(), { status: "signed", character: "Zibbo", spec: "Shaman-Elemental" });
        expect(pickClass(data(), other, "Mage").spec).toBe("Mage-Arcane");
        const tank = pickClass(data(), { ...other, spec: "Warrior-Protection" }, "Warrior");
        expect(tank).toMatchObject({ className: "Warrior", spec: "Warrior-Protection" });
        expect(pickClass(data(), tank, "Mage").spec).toBe("Mage-Arcane");
        const melee = pickClass(data(), { ...other, spec: "Shaman-Enhancement" }, "Warrior");
        expect(melee.spec).toBe("Warrior-Arms");
        expect(pickClass(data(), other, "Evoker")).toBe(other);
    });

    it("saves only a complete, new name", () => {
        const start = initialPick(data(), "Zibbo");
        const other = pickClass(data(), pickOther(data(), start), "Mage");
        expect(otherProblem(data(), other)).toBe("name");
        expect(canSave(data(), start, other)).toBe(false);
        expect(otherProblem(data(), { ...other, character: "Fr0st" })).toBe("name");
        expect(otherProblem(data(), { ...other, character: "Frostzwergenkoenig" })).toBe("name");
        expect(otherProblem(data(), { ...other, character: "ZIBBOWAR" })).toBe("taken");
        expect(otherProblem(data(), { ...other, character: "Frostzwerg", className: "" })).toBe("class");
        expect(otherProblem(data(), { ...other, character: "Frostzwerg", spec: "Priest-Holy" })).toBe("spec");
        const ok = { ...other, character: " Frostzwerg " };
        expect(otherProblem(data(), ok)).toBe("");
        // two parts (Forever): the server decides by the event's version
        expect(otherProblem(data(), { ...other, character: "Bruno  Stahl" })).toBe("");
        expect(pickChanged(start, ok)).toBe(true);
        expect(canSave(data(), start, ok)).toBe(true);
        // signed off: the name does not matter
        expect(canSave(data(), start, { ...other, status: "absence" })).toBe(true);
    });

    it("sends the trimmed name with its class", () => {
        const start = initialPick(data(), "Zibbo");
        const other = { ...pickClass(data(), pickOther(data(), start), "Mage"), character: " bruno   stahl ", status: "signed" as const };
        expect(signupEditInput("u1", start, other)).toEqual({ userId: "u1", status: "signed", from: "Zibbo", character: "bruno stahl", spec: "Mage-Arcane", className: "Mage" });
        expect(signupEditInput("u1", start, { ...other, status: "absence" })).toEqual({ userId: "u1", status: "absence", from: "Zibbo" });
    });
});

// The character picks of the signup dialog (lib/signupPicks.ts, #293/#320), run for real.
// The page, dialogs and roster are rendered in pages/SignupsPage.test.tsx,
// components/signup/SignupDialog.test.tsx and pages/raid-detail/RosterTab.signups.test.tsx.
import { describe, expect, it } from "vitest";
import * as picksLib from "./signupPicks";
import { requireBackend } from "../test/backend";

describe("SignupDialog", () => {
    it("sends every picked character in priority order (#293)", () => {
        expect(picksLib.MAX_CHARACTERS).toBe(requireBackend("services/signups/signupCharacters").MAX_CHARACTERS);
    });
});

describe("character picks (lib/signupPicks.ts, #293)", () => {
    const spec = (key: string, gear = "ready") => ({ key, label: key, icon: "", role: "", gear });
    const profile = {
        canOfftank: false, canHeal: false,
        characters: [
            { key: "zibbo", name: "Zibbo", className: "Priest", main: true, specs: [spec("Priest-Shadow", "none"), spec("Priest-Holy")] },
            { key: "zibbowar", name: "Zibbowar", className: "Warrior", main: false, specs: [spec("Warrior-Protection")] },
            { key: "alt", name: "Alt", className: "Mage", main: false, specs: [spec("Mage-Frost")] },
            { key: "twink", name: "Twink", className: "Rogue", main: false, specs: [spec("Rogue-Combat")] },
            { key: "empty", name: "Empty", className: "Druid", main: false, specs: [] },
        ],
    } as unknown as Parameters<typeof picksLib.initialPicks>[0];
    type Mine = Parameters<typeof picksLib.initialPicks>[1];

    it("starts with the main's first geared spec, or with what was stored", () => {
        expect(picksLib.initialPicks(profile, null)).toEqual([{ characterKey: "zibbo", spec: "Priest-Holy" }]);
        const mine = { characters: [{ character: "Zibbowar", spec: "Warrior-Protection" }, { character: "Zibbo", spec: "Priest-Holy" }, { character: "Gone", spec: "Mage-Fire" }] } as unknown as Mine;
        expect(picksLib.initialPicks(profile, mine)).toEqual([
            { characterKey: "zibbowar", spec: "Warrior-Protection" },
            { characterKey: "zibbo", spec: "Priest-Holy" },
        ]);
        // an old signup without the list still opens with its one character
        expect(picksLib.initialPicks(profile, { characters: [], character: "Zibbowar", spec: "Warrior-Protection" } as unknown as Mine)).toEqual([{ characterKey: "zibbowar", spec: "Warrior-Protection" }]);
    });

    it("adds up to three characters, never one twice, and reorders them", () => {
        let picks = picksLib.initialPicks(profile, null);
        picks = picksLib.addPick(profile, picks);
        picks = picksLib.addPick(profile, picks);
        expect(picks.map((p) => p.characterKey)).toEqual(["zibbo", "zibbowar", "alt"]);
        expect(picksLib.canAddPick(profile, picks)).toBe(false);
        expect(picksLib.addPick(profile, picks)).toBe(picks);
        picks = picksLib.movePick(picks, 2, -1);
        expect(picks.map((p) => p.characterKey)).toEqual(["zibbo", "alt", "zibbowar"]);
        expect(picksLib.movePick(picks, 0, -1)).toBe(picks);
        // picking a character that is already listed keeps it only on the changed line
        const swapped = picksLib.setPickCharacter(profile, picks, 0, "zibbowar");
        expect(swapped).toEqual([{ characterKey: "zibbowar", spec: "Warrior-Protection" }, { characterKey: "alt", spec: "Mage-Frost" }]);
        expect(picksLib.removePick(swapped, 0)).toEqual([{ characterKey: "alt", spec: "Mage-Frost" }]);
    });

    it("hands the API names and specs, dropping what the profile no longer has", () => {
        const picks = [{ characterKey: "zibbowar", spec: "Warrior-Protection" }, { characterKey: "zibbo", spec: "Priest-Discipline" }, { characterKey: "zibbo", spec: "Priest-Holy" }];
        expect(picksLib.picksToInput(profile, picks)).toEqual([
            { character: "Zibbowar", spec: "Warrior-Protection" },
            { character: "Zibbo", spec: "Priest-Holy" },
        ]);
    });
});

// #320: the web sets the status per character, the way Discord has since #302.
describe("a status per character in the dialog (lib/signupPicks.ts, #320)", () => {
    const spec = (key: string, gear = "ready") => ({ key, label: key, icon: "", role: "", gear });
    const profile = {
        canOfftank: false, canHeal: false,
        characters: [
            { key: "zibbo", name: "Zibbo", className: "Priest", main: true, specs: [spec("Priest-Shadow", "none"), spec("Priest-Holy")] },
            { key: "zibbowar", name: "Zibbowar", className: "Warrior", main: false, specs: [spec("Warrior-Protection"), spec("Warrior-Fury")] },
            { key: "alt", name: "Alt", className: "Mage", main: false, specs: [spec("Mage-Frost")] },
        ],
    } as unknown as Parameters<typeof picksLib.initialPicks>[0];
    const picks = (): picksLib.CharacterPick[] => [
        { characterKey: "zibbo", spec: "Priest-Holy", status: "signed" },
        { characterKey: "zibbowar", spec: "Warrior-Protection", status: "signed" },
    ];

    it("changes only the character whose status was picked", () => {
        const out = picksLib.setPickStatus(picks(), 0, "late");
        expect(out.map((p) => p.status)).toEqual(["late", "signed"]);
        // the others are untouched down to their character and spec
        expect(out[1]).toEqual({ characterKey: "zibbowar", spec: "Warrior-Protection", status: "signed" });
    });

    it("sets them all with the big switch", () => {
        expect(picksLib.setAllStatuses(picksLib.setPickStatus(picks(), 0, "late"), "bench").map((p) => p.status))
            .toEqual(["bench", "bench"]);
    });

    it("reports the shared status, and none while they differ", () => {
        expect(picksLib.commonStatus(picks(), "signed")).toBe("signed");
        expect(picksLib.commonStatus(picksLib.setPickStatus(picks(), 1, "bench"), "signed")).toBe("");
        expect(picksLib.commonStatus([], "late")).toBe("late");
    });

    it("mirrors the signup's own status on the first character, and keeps an absence for the person", () => {
        expect(picksLib.signupStatusOf(picksLib.setPickStatus(picks(), 0, "late"), "signed")).toBe("late");
        expect(picksLib.signupStatusOf(picksLib.setPickStatus(picks(), 1, "late"), "signed")).toBe("signed");
        expect(picksLib.signupStatusOf(picks(), "absence")).toBe("absence");
        expect(picksLib.signupStatusOf([], "signed")).toBe("signed");
    });

    it("keeps a character's status through a spec, character or order change, and gives a new one the first's", () => {
        const mixed = picksLib.setPickStatus(picks(), 1, "late");
        expect(picksLib.setPickSpec(mixed, 1, "Warrior-Fury")[1].status).toBe("late");
        expect(picksLib.setPickCharacter(profile, mixed, 1, "alt")[1].status).toBe("late");
        expect(picksLib.movePick(mixed, 0, 1).map((p) => p.status)).toEqual(["late", "signed"]);
        expect(picksLib.addPick(profile, mixed)[2].status).toBe("signed");
    });

    it("opens with the stored status per character, and sends each one along", () => {
        const mine = {
            status: "late",
            characters: [{ character: "Zibbo", spec: "Priest-Holy", status: "late" }, { character: "Zibbowar", spec: "Warrior-Protection", status: "signed" }],
        } as unknown as Parameters<typeof picksLib.initialPicks>[1];
        const opened = picksLib.initialPicks(profile, mine, "late");
        expect(opened).toEqual([
            { characterKey: "zibbo", spec: "Priest-Holy", status: "late" },
            { characterKey: "zibbowar", spec: "Warrior-Protection", status: "signed" },
        ]);
        expect(picksLib.picksToInput(profile, opened)).toEqual([
            { character: "Zibbo", spec: "Priest-Holy", status: "late" },
            { character: "Zibbowar", spec: "Warrior-Protection", status: "signed" },
        ]);
        // several raids at once share one status, so no character brings its own
        expect(picksLib.picksToInput(profile, picksLib.initialPicks(profile, null))).toEqual([{ character: "Zibbo", spec: "Priest-Holy" }]);
    });
});

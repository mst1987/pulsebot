// The bosses of the loading scene per game version: no TBC boss in the Forever part.
import { describe, expect, it } from "vitest";
import { bossesFor, pickBoss } from "../loaderBosses";

/** The TBC raid bosses — none of them belongs in the Forever part (Archimonde does: Forever's Hyjal). */
const TBC_ONLY = ["Malchezaar", "Gruul", "Magtheridon", "Lady Vashj", "Kael'thas", "Zul'jin", "Illidan", "Kil'jaeden"];

const labels = (version: string) => bossesFor(version).map((b) => b.label);

describe("bossesFor", () => {
    it("draws Forever's own raids and Classic's bosses in the Forever part — no TBC boss", () => {
        expect(labels("forever")).toEqual(expect.arrayContaining(["Sonya", "Archimonde", "Onyxia", "Ragnaros", "VanCleef"]));
        expect(labels("forever").filter((l) => TBC_ONLY.includes(l))).toEqual([]);
    });

    it("keeps TBC's bosses for TBC and Classic's for Classic and an unknown version", () => {
        expect(labels("tbc")).toEqual(expect.arrayContaining(TBC_ONLY));
        for (const version of ["classic", ""]) {
            expect(labels(version)).toContain("Ragnaros");
            expect(labels(version).filter((l) => TBC_ONLY.includes(l) || l === "Archimonde")).toEqual([]);
        }
    });

    it("gives every boss an icon of its own within a version", () => {
        for (const version of ["tbc", "classic", "forever"]) {
            const icons = bossesFor(version).map((b) => b.icon);
            expect(icons.every(Boolean)).toBe(true);
            expect(new Set(icons).size).toBe(icons.length);
        }
    });
});

describe("pickBoss", () => {
    it("draws from the version's own bosses", () => {
        for (let i = 0; i < 50; i++) expect(bossesFor("forever")).toContain(pickBoss("forever"));
    });
});

// Several characters per raider (#293) in the setup editor's moves
// (lib/signups/setupEditor.ts): a drag or pick of a "kann auch mit" character
// places exactly that one, "Charakter wechseln" keeps the place, the pool's role
// blocks list a person under every role one of their characters fits. The rest
// of the moves: setupEditor.test.ts.
import { describe, expect, it } from "vitest";
import type { SetupCharacter, SetupPerson, StoredSetup } from "../../api";
import * as lib from "./setupEditor";
import { t } from "../../i18n";

const char = (character: string, spec: string, role: SetupCharacter["role"], priority: number, extra: Partial<SetupCharacter> = {}): SetupCharacter => ({
    character, spec, role, priority, status: "signed", classId: spec.split("-")[0].toLowerCase(), classColor: "", classLabel: "", specLabel: spec, specIcon: "", ...extra,
});

const person = (userId: string, character: string, spec: string, role: SetupPerson["role"], extra: Partial<SetupPerson> = {}): SetupPerson => ({
    userId, character, spec, role, name: "", classId: "", classColor: "", classLabel: "", specLabel: "", specIcon: "", ...extra,
});

/** Zibbo signed up as a holy priest first, then the protection warrior Zibbowar and the mage Zibbomage. */
const ZIBBO_CHARS = [char("Zibbo", "Priest-Holy", "healer", 0), char("Zibbowar", "Warrior-Protection", "tank", 1, { status: "late" }), char("Zibbomage", "Mage-Fire", "ranged", 2)];
const ZIBBO = person("z", "Zibbo", "Priest-Holy", "healer", { characters: ZIBBO_CHARS });

function setup(): StoredSetup {
    return {
        version: 2,
        groups: [{ index: 1, slots: [{ ...person("t", "Bruno", "Warrior-Protection", "tank"), pos: 1 }] }],
        bench: [],
        pool: [ZIBBO],
    } as unknown as StoredSetup;
}

describe("several characters per raider (#293)", () => {
    const s = setup();
    const input = lib.toInput(s);
    const people = lib.peopleOf(s);

    it("places the character the orga dragged out of the pool — and locks a 'kann auch mit' one", () => {
        const out = lib.moveRaider(input, "z", { group: 1, pos: 3 }, people, 25, { z: "Zibbowar" });
        expect(out.input?.groups[0].slots.find((x) => x.userId === "z")).toEqual({ userId: "z", character: "Zibbowar", spec: "Warrior-Protection", role: "tank", locked: true, pos: 3 });
        // still one seat: the person is placed once
        expect(out.input?.groups.flatMap((g) => g.slots).filter((x) => x.userId === "z")).toHaveLength(1);
    });

    it("keeps the default without a choice, and does not lock the first choice picked by name", () => {
        const plain = lib.moveRaider(input, "z", { group: 1 }, people, 25);
        expect(plain.input?.groups[0].slots.find((x) => x.userId === "z")).toMatchObject({ character: "Zibbo", spec: "Priest-Holy", role: "healer", locked: false });
        const first = lib.moveRaider(input, "z", { group: 1 }, people, 25, { z: "zibbo" });
        expect(first.input?.groups[0].slots.find((x) => x.userId === "z")).toMatchObject({ character: "Zibbo", locked: false });
        // a name they did not sign up with is no choice at all
        const foreign = lib.moveRaider(input, "z", { group: 1 }, people, 25, { z: "Fremder" });
        expect(foreign.input?.groups[0].slots.find((x) => x.userId === "z")).toMatchObject({ character: "Zibbo" });
    });

    it("swaps a chosen character in onto a placed raider, and benches the chosen one", () => {
        const swap = lib.moveRaider(input, "z", { userId: "t" }, people, 25, { z: "Zibbomage" });
        expect(swap.input?.groups[0].slots).toEqual([{ userId: "z", character: "Zibbomage", spec: "Mage-Fire", role: "ranged", locked: true, pos: 1 }]);
        const bench = lib.moveRaider(input, "z", { bench: true }, people, 25, { z: "Zibbowar" });
        expect(bench.input?.bench).toEqual([{ userId: "z", character: "Zibbowar", locked: false }]);
    });

    it("switches a placed raider to another signed character: same place, locked; on the bench only the name", () => {
        const placed = lib.moveRaider(input, "z", { group: 1, pos: 4 }, people, 25).input!;
        const out = lib.switchCharacter(placed, "z", ZIBBO_CHARS[1]);
        expect(out.input?.groups[0].slots.find((x) => x.userId === "z")).toEqual({ userId: "z", character: "Zibbowar", spec: "Warrior-Protection", role: "tank", locked: true, pos: 4 });
        // again: nothing changes
        expect(lib.switchCharacter(out.input!, "z", ZIBBO_CHARS[1])).toEqual({ input: null });
        const benched = lib.moveRaider(input, "z", { bench: true }, people, 25).input!;
        expect(lib.switchCharacter(benched, "z", ZIBBO_CHARS[2]).input?.bench).toEqual([{ userId: "z", character: "Zibbomage", locked: false }]);
        // in the pool there is no place to switch
        expect(lib.switchCharacter(input, "z", ZIBBO_CHARS[1]).error).toBe(t("setup.moves.switchPool"));
    });

    it("draws the chosen character at once, before the server answers", () => {
        const out = lib.moveRaider(input, "z", { group: 1 }, people, 25, { z: "Zibbowar" });
        const drawn = lib.applyLocal(s, out.input!);
        const slot = drawn.groups[0].slots.find((x) => x.userId === "z");
        expect(slot).toMatchObject({ character: "Zibbowar", spec: "Warrior-Protection", role: "tank", status: "late", locked: true });
        // the person left the pool — with every character
        expect(drawn.pool).toEqual([]);
    });

    it("lists a person in every role block one of their characters fits, led there by that character", () => {
        expect(lib.leadIn(ZIBBO, "healer")).toBe(ZIBBO_CHARS[0]);
        expect(lib.leadIn(ZIBBO, "tank")).toBe(ZIBBO_CHARS[1]);
        expect(lib.leadIn(ZIBBO, "ranged")).toBe(ZIBBO_CHARS[2]);
        expect(lib.leadIn(ZIBBO, "melee")).toBeNull();
        expect(lib.fitsRole(ZIBBO, "tank")).toBe(true);
        // one character only: the block of the role they stand as
        const solo = person("s", "Solo", "Rogue-Combat", "melee");
        expect(lib.fitsRole(solo, "melee")).toBe(true);
        expect(lib.fitsRole(solo, "tank")).toBe(false);
        expect(lib.poolRole("")).toBe("ranged");
        expect(lib.characterNamed(ZIBBO, "ZIBBOWAR")).toBe(ZIBBO_CHARS[1]);
        expect(lib.asCharacter(ZIBBO, ZIBBO_CHARS[1])).toMatchObject({ userId: "z", character: "Zibbowar", role: "tank", status: "late" });
    });
});

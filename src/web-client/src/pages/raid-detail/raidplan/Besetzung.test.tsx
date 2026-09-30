// The "Besetzung" (Roster slots) block is collapsible like the other editor blocks since #556: a chevron in its header,
// keyboard accessible (aria-expanded), folded state remembered in this browser across a reload.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Besetzung from "./Besetzung";
import { emptyBoard } from "../../../lib/raidplan/model";
import type { Besetzung as BesetzungData, RaidplanBoard } from "../../../api";

const besetzung: BesetzungData = { size: 10, counts: { tank: 2, healer: 2, dps: 6, melee: 0, ranged: 0 }, groups: 2, split: false };

function setup() {
    return render(
        <Besetzung
            board={emptyBoard()} besetzung={besetzung} roster={[]} players={new Map()} isEvent={false} canWrite
            edit={vi.fn()} editAll={vi.fn()} onPlaceDown={vi.fn()} onChipDown={vi.fn()} onShow={vi.fn()} onAssign={vi.fn()}
        />,
    );
}

beforeEach(() => { window.localStorage.clear(); });

describe("Besetzung head line (#559)", () => {
    it("the chevron sits in the title's own line, left of the title - no extra row", () => {
        setup();
        const top = document.querySelector(".rp-bes-top") as HTMLElement;
        expect(top.firstElementChild?.getAttribute("aria-expanded")).toBe("true");
        expect(top.children[1].textContent).toContain("Besetzung");
        // the section has the head line and the blocks only, the chevron is not a row between them
        expect(Array.from(document.querySelector(".rp-bes")!.children).filter((c) => c.matches("button"))).toHaveLength(0);
    });

    it("folded, one line says how many slots are filled and how many are open (a warning badge)", () => {
        const board = { ...emptyBoard(), slots: [
            { id: "a", kind: "tank", n: 1, userId: "u1" }, { id: "b", kind: "healer", n: 1, userId: "u2" }, { id: "c", kind: "healer", n: 2, userId: "" },
        ] } as unknown as RaidplanBoard;
        render(<Besetzung board={board} besetzung={besetzung} roster={[]} players={new Map()} isEvent canWrite edit={vi.fn()} editAll={vi.fn()} onPlaceDown={vi.fn()} onChipDown={vi.fn()} onShow={vi.fn()} onAssign={vi.fn()} />);
        expect(document.querySelector(".rp-bes-sum")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: /Einklappen/ }));
        const sum = document.querySelector(".rp-bes-sum") as HTMLElement;
        expect(sum.textContent).toContain("2 besetzt");
        expect(sum.querySelector(".rp-acard-open")?.textContent).toBe("1 offen");
    });
});

describe("Besetzung block (#556)", () => {
    it("opens by default and folds on the chevron, hiding the role blocks", () => {
        setup();
        expect(document.querySelector(".rp-bes-blocks")).not.toBeNull();
        const toggle = screen.getByRole("button", { name: /Einklappen/ });
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        fireEvent.click(toggle);
        expect(document.querySelector(".rp-bes-blocks")).toBeNull();
        expect(screen.getByRole("button", { name: /Ausklappen/ }).getAttribute("aria-expanded")).toBe("false");
    });

    it("remembers the fold across a remount (a reload)", () => {
        const first = setup();
        fireEvent.click(screen.getByRole("button", { name: /Einklappen/ }));
        expect(document.querySelector(".rp-bes-blocks")).toBeNull();
        first.unmount();

        setup();
        expect(document.querySelector(".rp-bes-blocks")).toBeNull();
        expect(screen.getByRole("button", { name: /Ausklappen/ }).getAttribute("aria-expanded")).toBe("false");
    });
});

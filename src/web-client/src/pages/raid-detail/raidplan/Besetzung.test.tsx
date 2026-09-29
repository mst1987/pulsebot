// The "Besetzung" (Roster slots) block is collapsible like the other editor blocks since #556: a chevron in its header,
// keyboard accessible (aria-expanded), folded state remembered in this browser across a reload.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Besetzung from "./Besetzung";
import { emptyBoard } from "../../../lib/raidplan/model";
import type { Besetzung as BesetzungData } from "../../../api";

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

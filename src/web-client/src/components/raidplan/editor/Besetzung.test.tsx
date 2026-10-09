// The "Besetzung" (Roster slots) since Oct 2026: ONE line "25 Spieler · 3 Tanks · 7 Heiler · 15 DD" with "Ändern", which opens
// today's steppers and chips; the open state is remembered in this browser across a reload (keyboard accessible: aria-expanded).
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Besetzung from "./Besetzung";
import { emptyBoard } from "../../../lib/raidplan/model";
import type { Besetzung as BesetzungData, RaidplanBoard } from "../../../api";

const besetzung: BesetzungData = { size: 10, counts: { tank: 2, healer: 2, dps: 6, melee: 0, ranged: 0 }, groups: 2, split: false };

function setup(tools?: JSX.Element) {
    return render(
        <Besetzung
            board={emptyBoard()} besetzung={besetzung} roster={[]} players={new Map()} isEvent={false} canWrite
            edit={vi.fn()} editAll={vi.fn()} onPlaceDown={vi.fn()} onChipDown={vi.fn()} onShow={vi.fn()} onAssign={vi.fn()} tools={tools}
        />,
    );
}

beforeEach(() => { window.localStorage.clear(); });

describe("Besetzung as one line (Oct 2026)", () => {
    it("is one line by default: the counts by role with a word each, and 'Ändern'", () => {
        const board = { ...emptyBoard(), slots: [
            { id: "a", kind: "tank", n: 1, userId: "u1" }, { id: "b", kind: "healer", n: 1, userId: "u2" }, { id: "c", kind: "healer", n: 2, userId: "" },
            { id: "d", kind: "melee", n: 1, userId: "u3" }, { id: "e", kind: "ranged", n: 1, userId: "u4" }, { id: "g", kind: "group", n: 1 },
        ] } as unknown as RaidplanBoard;
        render(<Besetzung board={board} besetzung={besetzung} roster={[]} players={new Map()} isEvent canWrite edit={vi.fn()} editAll={vi.fn()} onPlaceDown={vi.fn()} onChipDown={vi.fn()} onShow={vi.fn()} onAssign={vi.fn()} />);
        expect(document.querySelector(".rp-bes-blocks")).toBeNull();
        const sum = document.querySelector(".rp-bes-sum") as HTMLElement;
        // a group marker is no raider's slot
        expect(sum.textContent).toContain("5 Spieler");
        expect(sum.textContent).toContain("1 Tanks");
        expect(sum.textContent).toContain("2 Heiler");
        expect(sum.textContent).toContain("2 DD");
        expect(sum.querySelector(".rp-acard-open")?.textContent).toBe("1 offen");
        const edit = screen.getByRole("button", { name: /Besetzung: Ändern/ });
        expect(edit.getAttribute("aria-expanded")).toBe("false");
        // the one line has no other buttons (the roster dialog and the refill wait behind "Ändern")
        expect(document.querySelectorAll(".rp-bes button")).toHaveLength(1);
    });

    it("'Ändern' opens today's steppers and chips, 'Fertig' folds them again; the tools only open", () => {
        setup(<span className="probe-tools">Gruppen</span>);
        expect(document.querySelector(".probe-tools")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: /Besetzung: Ändern/ }));
        expect(document.querySelector(".rp-bes-blocks")).not.toBeNull();
        expect(document.querySelector(".probe-tools")).not.toBeNull();
        expect(screen.getAllByRole("button", { name: /einer mehr/ }).length).toBeGreaterThan(0);
        expect(screen.getByRole("button", { name: /Besetzung zuweisen/ })).toBeTruthy();
        const done = screen.getByRole("button", { name: /Besetzung: Fertig/ });
        expect(done.getAttribute("aria-expanded")).toBe("true");
        fireEvent.click(done);
        expect(document.querySelector(".rp-bes-blocks")).toBeNull();
    });

    it("remembers that it was opened across a remount (a reload)", () => {
        const first = setup();
        fireEvent.click(screen.getByRole("button", { name: /Besetzung: Ändern/ }));
        first.unmount();
        setup();
        expect(document.querySelector(".rp-bes-blocks")).not.toBeNull();
        expect(screen.getByRole("button", { name: /Besetzung: Fertig/ }).getAttribute("aria-expanded")).toBe("true");
    });

    it("a template counts slots, not players", () => {
        setup();
        expect((document.querySelector(".rp-bes-sum") as HTMLElement).textContent).toContain("0 Slots");
    });
});

// Names with a last name (WoW Forever) through the board's own parts: groups, bench and the read-only
// lineup, which takes the flag from the server's answer. One line on its own: shortNames.test.tsx.
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SetupPerson } from "../../../../api";
import { renderPage } from "../../../../test/render";
import { editorData, person } from "../../../../test/fixtures/setupEditor";
import { BenchCard, GroupCard, ReadOnly, Slot, type Interaction } from "../Board";

const LONG = "Konstantinos Mustermann";
const SHORT = "Konstantinos M.";

const RAIDER: SetupPerson = person("u1", LONG);

function ui(over: Partial<Interaction> = {}): Interaction {
    return {
        editable: true, selected: null, dragging: null, attendance: {}, suggest: null, extraRoles: {},
        onInspect: vi.fn(), onPick: vi.fn(), onDrop: vi.fn(), onDrag: vi.fn(), ...over,
    };
}
// the editor's interaction: onLeave means there is a peek that shows the raider
const EDITOR = { shortNames: true, onLeave: vi.fn() };

describe("a line of the setup", () => {
    it("keeps the raider's identity for a drag: the line's data stays the stored name", () => {
        renderPage(<Slot p={RAIDER} ui={ui(EDITOR)} as={LONG} />);
        expect(screen.getByText(SHORT).closest(".se-slot")).toHaveAttribute("data-character", LONG);
    });
});

describe("a group and the bench", () => {
    const group = { index: 1, slots: [{ ...RAIDER, pos: 1 }] };

    it("WoW Forever: shorten", () => {
        renderPage(<><GroupCard group={group} buffs={[]} ui={ui(EDITOR)} /><BenchCard bench={[person("u3", "Maximiliano Winterfeld")]} ui={ui(EDITOR)} /></>);
        expect(screen.getByText(SHORT)).toBeInTheDocument();
        expect(screen.getByText("Maximiliano W.")).toBeInTheDocument();
    });

    it("TBC: stay whole", () => {
        renderPage(<><GroupCard group={group} buffs={[]} ui={ui()} /><BenchCard bench={[person("u3", "Maximiliano Winterfeld")]} ui={ui()} /></>);
        expect(screen.getByText(LONG)).toBeInTheDocument();
        expect(screen.getByText("Maximiliano Winterfeld")).toBeInTheDocument();
    });
});

describe("the read-only lineup", () => {
    const approved = { groups: [{ index: 1, slots: [{ ...RAIDER, pos: 1 }] }], bench: [] };

    it("WoW Forever: takes the flag from the answer and shows the whole name in a tooltip", () => {
        renderPage(<ReadOnly data={editorData({ approved, lastNames: true } as never)} />);
        expect(screen.getByText(SHORT)).toHaveAttribute("data-tip", LONG);
    });

    it("TBC: stays whole", () => {
        renderPage(<ReadOnly data={editorData({ approved, lastNames: false } as never)} />);
        expect(screen.getByText(LONG)).toBeInTheDocument();
    });
});

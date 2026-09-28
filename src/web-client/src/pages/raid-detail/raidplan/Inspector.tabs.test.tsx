// The inspector in tabs (#528): a group marker (Gruppe | Darstellung | Ring & Badge), a role group (Gruppe | Form | Darstellung) and an
// icon that faces (Symbol | Blickrichtung). Every field stays, one tab at a time; the last tab is remembered; the badge options edit the group.
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RaidplanBoard, RaidplanIcon, RaidplanSlot, RaidplanZone } from "../../../api";
import { emptyBoard, type Selection } from "../../../lib/raidplan";
import Inspector from "./Inspector";

const group = (extra: Partial<RaidplanSlot> = {}): RaidplanSlot => ({
    id: "g1", kind: "group", n: 2, label: "", x: 0.5, y: 0.5, userId: "", size: 38, hideMembers: false, split: true, offsets: {}, placed: true,
    opacity: 1, lock: false, hidden: false, ...extra,
});
const roleZone: RaidplanZone = { id: "z1", shape: "ellipse", type: "role", role: "melee", label: "", color: "#f97316", x: 0.1, y: 0.1, w: 0.2, h: 0.2 } as RaidplanZone;
const boss: RaidplanIcon = { id: "i1", iconKey: "boss:601", label: "Boss", showLabel: false, x: 0.5, y: 0.5, size: 48, rotation: 0, opacity: 1, lock: false, hidden: false } as unknown as RaidplanIcon;

function Harness({ initial, sel, out }: { initial: RaidplanBoard; sel: Selection; out: { board: RaidplanBoard } }) {
    const [board, setBoard] = useState(initial);
    out.board = board;
    return <Inspector board={board} selection={sel} players={new Map()} roster={[]} isEvent={false} canWrite edit={(fn) => setBoard((b) => fn(b))} onSelect={() => undefined} />;
}

function show(over: Partial<RaidplanBoard>, sel: Selection) {
    const out = { board: { ...emptyBoard(), ...over } as RaidplanBoard };
    const view = render(<Harness initial={out.board} sel={sel} out={out} />);
    const tabs = () => within(screen.getByRole("radiogroup", { name: /Einstellungen/ })).getAllByRole("radio").map((b) => b.textContent);
    const open = (name: string) => fireEvent.click(within(screen.getByRole("radiogroup", { name: /Einstellungen/ })).getByRole("radio", { name }));
    return { ...view, out, tabs, open };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe("the group marker's inspector in tabs", () => {
    it("three tabs, the first open; each shows its own fields only", () => {
        const { tabs, open } = show({ slots: [group()] }, { kind: "slot", id: "g1" });
        expect(tabs()).toEqual(["Gruppe", "Darstellung", "Ring & Badge"]);
        expect(screen.getByText("Nummer")).toBeInTheDocument();
        expect(screen.getByLabelText(/Aufgesplittet/)).toBeChecked();
        expect(screen.queryByText("Token-Größe")).toBeNull();
        expect(screen.queryByText("Badge anzeigen")).toBeNull();
        open("Darstellung");
        expect(screen.getByText("Gruppengröße")).toBeInTheDocument();
        expect(screen.getByText("Token-Größe")).toBeInTheDocument();
        expect(screen.getByText("Kranz-Abstand")).toBeInTheDocument();
        expect(screen.getByText("Deckkraft")).toBeInTheDocument();
        expect(screen.queryByText("Nummer")).toBeNull();
        open("Ring & Badge");
        expect(screen.getByText("Gruppenfarbe")).toBeInTheDocument();
        expect(screen.getByLabelText("Rahmen anzeigen")).toBeChecked();
        expect(screen.getByLabelText("Badge anzeigen")).toBeChecked();
        expect(screen.getByText("Badge-Größe")).toBeInTheDocument();
    });

    it("remembers the last tab for the next group", () => {
        const first = show({ slots: [group()] }, { kind: "slot", id: "g1" });
        first.open("Ring & Badge");
        first.unmount();
        show({ slots: [group()] }, { kind: "slot", id: "g1" });
        expect(screen.getByLabelText("Badge anzeigen")).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: "Ring & Badge" })).toHaveAttribute("aria-checked", "true");
    });

    it("the badge: off hides its size, the size goes to the group (50 .. 150 %)", () => {
        const { open, out } = show({ slots: [group()] }, { kind: "slot", id: "g1" });
        open("Ring & Badge");
        const size = screen.getByRole("textbox", { name: /Badge-Größe/ });
        fireEvent.change(size, { target: { value: "60" } });
        fireEvent.blur(size);
        expect(out.board.slots[0].badgeScale).toBeCloseTo(0.6, 9);
        fireEvent.click(screen.getByLabelText("Badge anzeigen"));
        expect(out.board.slots[0].showBadge).toBe(false);
        expect(screen.queryByText("Badge-Größe")).toBeNull();
    });

    it("a group that is not split: no ring switch, a hint instead", () => {
        const { open } = show({ slots: [group({ split: false })] }, { kind: "slot", id: "g1" });
        open("Ring & Badge");
        expect(screen.queryByLabelText("Rahmen anzeigen")).toBeNull();
        expect(screen.getByText(/nur eine aufgesplittete Gruppe/)).toBeInTheDocument();
        expect(screen.getByLabelText("Badge anzeigen")).toBeInTheDocument();
    });
});

describe("other long inspectors in tabs", () => {
    it("a role group: Gruppe | Form | Darstellung", () => {
        const { tabs, open } = show({ zones: [roleZone] }, { kind: "zone", id: "z1" });
        expect(tabs()).toEqual(["Gruppe", "Form", "Darstellung"]);
        expect(screen.getByText(/^Anzahl/)).toBeInTheDocument();
        open("Form");
        expect(screen.getByText("Breite")).toBeInTheDocument();
        expect(screen.getByText("Zone skalieren")).toBeInTheDocument();
        open("Darstellung");
        expect(screen.getByText("Beschriftung", { selector: ".rp-kicker" })).toBeInTheDocument();
        expect(screen.getByText("Deckkraft")).toBeInTheDocument();
    });

    it("an icon that faces: Symbol | Blickrichtung", () => {
        const { tabs, open } = show({ icons: [boss] }, { kind: "icon", id: "i1" });
        expect(tabs()).toEqual(["Symbol", "Blickrichtung"]);
        expect(screen.getByText("Beschriftung anzeigen")).toBeInTheDocument();
        open("Blickrichtung");
        expect(screen.getByText("Pfeilgröße")).toBeInTheDocument();
        expect(screen.queryByText("Beschriftung anzeigen")).toBeNull();
    });

    it("a short one (a plain zone) keeps its single column", () => {
        show({ zones: [{ ...roleZone, type: "neutral", role: undefined } as RaidplanZone] }, { kind: "zone", id: "z1" });
        expect(screen.queryByRole("radiogroup", { name: /Einstellungen/ })).toBeNull();
        expect(screen.getByText("Zone skalieren")).toBeInTheDocument();
    });
});

// The inspector of a plain zone: fire as a type, its entrance as a segment (never a checkbox) and its turn
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RaidplanBoard, RaidplanZone } from "../../../api";
import { emptyBoard } from "../../../lib/raidplan";
import Inspector from "./Inspector";

const fire = { id: "z1", shape: "rect", type: "fire", label: "", color: "#4fa82a", x: 0.1, y: 0.1, w: 0.4, h: 0.1, opacity: 0.35, lock: false, hidden: false } as RaidplanZone;

function Harness({ initial, out }: { initial: RaidplanBoard; out: { board: RaidplanBoard } }) {
    const [board, setBoard] = useState(initial);
    out.board = board;
    return <Inspector board={board} selection={{ kind: "zone", id: "z1" }} players={new Map()} roster={[]} isEvent={false} canWrite edit={(fn) => setBoard((b) => fn(b))} onSelect={() => undefined} />;
}
function show(zone: RaidplanZone) {
    const out = { board: { ...emptyBoard(), zones: [zone] } as RaidplanBoard };
    render(<Harness initial={out.board} out={out} />);
    return out;
}

describe("a plain zone's inspector", () => {
    it("offers fire as a zone type", () => {
        show(fire);
        expect(screen.getByRole("option", { name: /Feuerfläche/ })).toBeInTheDocument();
    });
    it("picks the entrance in a segment, fade by default; fade is not stored", () => {
        const out = show(fire);
        const seg = screen.getByRole("radiogroup", { name: "Einstieg" });
        expect(within(seg).getAllByRole("radio")).toHaveLength(6);
        expect(within(seg).getByRole("radio", { name: "Einblenden" })).toHaveAttribute("aria-checked", "true");
        fireEvent.click(within(seg).getByRole("radio", { name: "Von links" }));
        expect(out.board.zones[0].enter).toBe("w");
        expect(within(seg).getByRole("radio", { name: "Von links" })).toHaveAttribute("aria-checked", "true");
        fireEvent.click(within(seg).getByRole("radio", { name: "Einblenden" }));
        expect(out.board.zones[0].enter).toBeUndefined();
        expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    });
    it("turns the zone and resets the turn", () => {
        const out = show({ ...fire, rotation: 30 });
        expect(screen.getByText("Drehung (°)")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Drehung zurücksetzen" }));
        expect(out.board.zones[0].rotation).toBe(0);
    });
});

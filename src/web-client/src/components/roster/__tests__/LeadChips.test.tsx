// Leader flags (#1034): the chips the orga and the person switch, and the crown
// that marks a leader in the setup and the roster.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { leadList } from "../../../lib/roster/leaders";
import { LeadChips, LeadMark } from "../LeadChips";

const KARA = { id: "kara", name: "Karazhan", short: "Kara", icon: "" };
const GRUUL = { id: "gruul", name: "Gruul's Lair", short: "Gruul", icon: "" };

describe("LeadChips", () => {
    it("switches one instance on or off and keeps the others", () => {
        const onChange = vi.fn();
        render(<LeadChips instances={[KARA, GRUUL]} value={["gruul"]} onChange={onChange} />);
        expect(screen.getByRole("group")).toHaveAccessibleName("Instanzen, die diese Person leiten kann");
        fireEvent.click(screen.getByRole("button", { name: /Kara/ }));
        expect(onChange).toHaveBeenLastCalledWith(["gruul", "kara"]);
        fireEvent.click(screen.getByRole("button", { name: /Gruul/ }));
        expect(onChange).toHaveBeenLastCalledWith([]);
        expect(screen.queryByRole("checkbox")).toBeNull();
    });
});

describe("LeadMark", () => {
    it("draws a crown that names the instances in the version's order", () => {
        render(<LeadMark instances={[KARA, GRUUL]} ids={["gruul", "kara"]} />);
        expect(screen.getByRole("img")).toHaveAccessibleName("Leader: Kara, Gruul");
        expect(leadList([KARA, GRUUL], ["gruul"])).toBe("Gruul");
    });

    it("draws nothing without a flag — being orga makes nobody a leader", () => {
        const { container } = render(<LeadMark instances={[KARA]} ids={undefined} />);
        expect(container).toBeEmptyDOMElement();
        render(<LeadMark instances={[KARA]} ids={[]} />);
        expect(screen.queryByRole("img")).toBeNull();
    });
});

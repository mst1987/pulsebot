// The compact version switch every list that mixes game versions shows
// (#545): roster, loot history, raids, raid templates, loot council, dashboard.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import VersionFilter from "./VersionFilter";

const VERSIONS = [
    { id: "tbc", label: "WoW TBC Anniversary", short: "TBC", count: 5 },
    { id: "forever", label: "WoW Forever", short: "Forever", count: 2 },
];

describe("VersionFilter", () => {
    it("renders nothing with one version or fewer — a switch of one filters nothing", () => {
        const { container } = render(
            <VersionFilter versions={[VERSIONS[0]]} value="tbc" onChange={vi.fn()} ariaLabel="Spielversion" />,
        );
        expect(container).toBeEmptyDOMElement();

        const none = render(<VersionFilter versions={[]} value="tbc" onChange={vi.fn()} ariaLabel="Spielversion" />);
        expect(none.container).toBeEmptyDOMElement();
    });

    it("lists every version with its short name and count, plus 'Alle', and checks the current one", () => {
        render(<VersionFilter versions={VERSIONS} value="tbc" onChange={vi.fn()} ariaLabel="Spielversion" />);
        const group = screen.getByRole("radiogroup", { name: "Spielversion" });
        expect(within(group).getByRole("radio", { name: "TBC · 5" })).toHaveAttribute("aria-checked", "true");
        expect(within(group).getByRole("radio", { name: "Forever · 2" })).toHaveAttribute("aria-checked", "false");
        expect(within(group).getByRole("radio", { name: "Alle" })).toHaveAttribute("aria-checked", "false");
        // The version's full name travels as the option's tooltip.
        expect(within(group).getByRole("radio", { name: "Forever · 2" })).toHaveAttribute("data-tip", "WoW Forever");
    });

    it("shows the name alone when a caller has no count to give (the dashboard toggle)", () => {
        render(<VersionFilter versions={[{ id: "tbc", label: "TBC", short: "TBC" }, { id: "forever", label: "Forever", short: "Forever" }]} value="tbc" onChange={vi.fn()} ariaLabel="Spielversion" />);
        expect(screen.getByRole("radio", { name: "TBC" })).toBeInTheDocument();
    });

    it("reports a click with the version id, or 'all' for the lift-the-filter option", async () => {
        const onChange = vi.fn();
        render(<VersionFilter versions={VERSIONS} value="tbc" onChange={onChange} ariaLabel="Spielversion" />);
        await userEvent.click(screen.getByRole("radio", { name: "Forever · 2" }));
        expect(onChange).toHaveBeenCalledWith("forever");
        await userEvent.click(screen.getByRole("radio", { name: "Alle" }));
        expect(onChange).toHaveBeenCalledWith("all");
    });

    it("shows the 'Alle' tooltip a caller passes (the roster explains attendance)", () => {
        render(<VersionFilter versions={VERSIONS} value="tbc" onChange={vi.fn()} ariaLabel="Spielversion" allTip="Zählt jeden Raid." />);
        expect(screen.getByRole("radio", { name: "Alle" })).toHaveAttribute("data-tip", "Zählt jeden Raid.");
    });
});

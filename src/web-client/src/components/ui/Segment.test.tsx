// The segmented switch (design issue #221): one choice out of a few, all visible.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Segment from "./Segment";

type Role = "all" | "tank" | "healer";

function renderSegment(value: Role, onChange = vi.fn()) {
    render(
        <Segment<Role>
            ariaLabel="Rolle"
            value={value}
            onChange={onChange}
            options={[
                { value: "all", label: "Alle" },
                { value: "tank", label: "Tank", icon: "inv_shield_06", tip: "Nur Tanks" },
                { value: "healer", label: "Heiler", disabled: true },
            ]}
        />,
    );
    return onChange;
}

describe("Segment", () => {
    it("is a named radio group with the current value checked", () => {
        renderSegment("tank");
        expect(screen.getByRole("radiogroup", { name: "Rolle" })).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: "Tank" })).toHaveAttribute("aria-checked", "true");
        expect(screen.getByRole("radio", { name: "Alle" })).toHaveAttribute("aria-checked", "false");
        expect(screen.getByRole("radio", { name: "Tank" })).toHaveAttribute("data-tip", "Nur Tanks");
    });

    it("reports the picked value, and a disabled option cannot be picked", async () => {
        const onChange = renderSegment("all");
        await userEvent.click(screen.getByRole("radio", { name: "Tank" }));
        expect(onChange).toHaveBeenCalledWith("tank");
        await userEvent.click(screen.getByRole("radio", { name: "Heiler" }));
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});

// The on/off switch: a labelled role="switch" control instead of a bare checkbox.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Switch from "./Switch";

describe("Switch", () => {
    it("is a switch named by its label, on or off", () => {
        render(<Switch checked label="Aufteilen" onChange={() => {}} />);
        expect(screen.getByRole("switch", { name: "Aufteilen" })).toBeChecked();
    });

    it("reports the new state on a click on the label", async () => {
        const onChange = vi.fn();
        render(<Switch checked={false} label="Aufteilen" onChange={onChange} />);
        await userEvent.click(screen.getByText("Aufteilen"));
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it("can be switched with the keyboard", async () => {
        const onChange = vi.fn();
        render(<Switch checked label="Aufteilen" onChange={onChange} />);
        screen.getByRole("switch").focus();
        await userEvent.keyboard(" ");
        expect(onChange).toHaveBeenCalledWith(false);
    });

    it("does nothing while disabled and carries its explanation as a tooltip", async () => {
        const onChange = vi.fn();
        const { container } = render(<Switch checked={false} disabled label="Aufteilen" tip="Erklärung" onChange={onChange} />);
        await userEvent.click(screen.getByText("Aufteilen"));
        expect(onChange).not.toHaveBeenCalled();
        const row = container.querySelector(".switch-row");
        expect(row).toHaveClass("is-disabled");
        expect(row).toHaveAttribute("data-tip-sub", "Erklärung");
    });
});

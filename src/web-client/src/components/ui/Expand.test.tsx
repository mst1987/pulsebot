// The one way to fold something open (design issue #221): label plus chevron button.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Expand from "./Expand";

describe("Expand", () => {
    it("says whether it is open and toggles on a click", async () => {
        const onToggle = vi.fn();
        const { rerender } = render(<Expand open={false} onToggle={onToggle} />);
        const btn = screen.getByRole("button", { name: "Details" });
        expect(btn).toHaveAttribute("aria-expanded", "false");
        await userEvent.click(btn);
        expect(onToggle).toHaveBeenCalledTimes(1);
        rerender(<Expand open onToggle={onToggle} />);
        expect(btn).toHaveAttribute("aria-expanded", "true");
    });

    it("keeps its name for a screen reader when the label is not shown", () => {
        render(<Expand open onToggle={() => undefined} label="Gruppe" showLabel={false} />);
        const btn = screen.getByRole("button", { name: "Gruppe" });
        expect(btn).not.toHaveTextContent("Gruppe");
    });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import NumberStepper from "./NumberStepper";

const base = { min: 0, max: 10, ariaLabel: "Wert", lessLabel: "Weniger", moreLabel: "Mehr" };

describe("ui/NumberStepper", () => {
    it("steps within its range and disables the buttons at the ends", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const { rerender } = render(<NumberStepper {...base} value={10} step={3} onChange={onChange} />);
        expect(screen.getByRole("button", { name: "Mehr" })).toBeDisabled();
        await user.click(screen.getByRole("button", { name: "Weniger" }));
        expect(onChange).toHaveBeenLastCalledWith(7);
        rerender(<NumberStepper {...base} value={1} step={3} onChange={onChange} />);
        await user.click(screen.getByRole("button", { name: "Weniger" }));
        expect(onChange).toHaveBeenLastCalledWith(0);
    });

    it("shows a value of its own and takes own steps, null disabling one", async () => {
        const user = userEvent.setup();
        const onMore = vi.fn();
        render(<NumberStepper {...base} value={null} display="ganzer Abend" onChange={() => undefined} onLess={null} onMore={onMore} />);
        expect(screen.getByRole("group", { name: "Wert" })).toHaveTextContent("ganzer Abend");
        expect(screen.getByRole("button", { name: "Weniger" })).toBeDisabled();
        await user.click(screen.getByRole("button", { name: "Mehr" }));
        expect(onMore).toHaveBeenCalledTimes(1);
    });

    it("commits a typed value on Enter or blur (commit=blur), every valid keystroke with commit=input", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const { unmount } = render(<NumberStepper {...base} value={4} editable onChange={onChange} />);
        const field = screen.getByRole("spinbutton", { name: "Wert" });
        await user.clear(field);
        await user.type(field, "8");
        expect(onChange).not.toHaveBeenCalled();
        await user.keyboard("{Enter}");
        expect(onChange).toHaveBeenLastCalledWith(8);
        await user.clear(field);
        await user.type(field, "42");
        await user.tab();
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(field).toHaveValue(4);
        unmount();

        const live = vi.fn();
        render(<NumberStepper {...base} value={4} editable commit="input" onChange={live} />);
        await user.type(screen.getByRole("spinbutton", { name: "Wert" }), "{backspace}7");
        expect(live).toHaveBeenLastCalledWith(7);
    });
});

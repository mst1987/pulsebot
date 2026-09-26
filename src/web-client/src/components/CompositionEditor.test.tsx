// Tanks and healers of a raid (#266/#261): two large numbers with − and +,
// one small line saying what is left for damage dealers, the plus capped at
// the raid's size.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import CompositionEditor from "./CompositionEditor";

describe("CompositionEditor", () => {
    it("says what is left for DPS, in the singular for one place", () => {
        const { rerender } = render(<CompositionEditor size={10} value={{ tank: 2, healer: 5 }} onChange={() => {}} />);
        expect(screen.getByText("3 Plätze für DPS · Vorschlag bei Größenwechsel")).toBeInTheDocument();
        rerender(<CompositionEditor size={10} value={{ tank: 3, healer: 6 }} onChange={() => {}} />);
        expect(screen.getByText("1 Platz für DPS · Vorschlag bei Größenwechsel")).toBeInTheDocument();
        // without a size there is nothing to say
        rerender(<CompositionEditor size={null} value={{ tank: 3, healer: 6 }} onChange={() => {}} />);
        expect(screen.queryByText(/für DPS/)).not.toBeInTheDocument();
    });

    it("changes a count with − and +, and caps the plus at the size", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const { rerender } = render(<CompositionEditor size={10} value={{ tank: 2, healer: 3 }} onChange={onChange} />);
        await user.click(screen.getByRole("button", { name: t("raidPlan.comp.tankMore") }));
        expect(onChange).toHaveBeenLastCalledWith({ tank: 3, healer: 3 });
        await user.click(screen.getByRole("button", { name: t("raidPlan.comp.healerLess") }));
        expect(onChange).toHaveBeenLastCalledWith({ tank: 2, healer: 2 });

        rerender(<CompositionEditor size={5} value={{ tank: 2, healer: 3 }} onChange={onChange} />);
        expect(screen.getByRole("button", { name: t("raidPlan.comp.tankMore") })).toBeDisabled();
        expect(screen.getByRole("button", { name: t("raidPlan.comp.healerMore") })).toBeDisabled();
        expect(screen.getByRole("button", { name: t("raidPlan.comp.tankLess") })).toBeEnabled();
        rerender(<CompositionEditor size={5} value={{ tank: 0, healer: 1 }} onChange={onChange} />);
        expect(screen.getByRole("button", { name: t("raidPlan.comp.tankLess") })).toBeDisabled();
    });
});

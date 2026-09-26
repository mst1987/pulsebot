import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Badge from "./Badge";

describe("Badge", () => {
    it("shows its text", () => {
        render(<Badge tone="ok">Bestätigt</Badge>);
        expect(screen.getByText("Bestätigt")).toBeInTheDocument();
    });

    it("gets a remove button only with onRemove, and the button calls it", async () => {
        const { rerender } = render(<Badge>Filter</Badge>);
        expect(screen.queryByRole("button")).not.toBeInTheDocument();

        const onRemove = vi.fn();
        rerender(<Badge onRemove={onRemove} removeLabel="Filter entfernen">Filter</Badge>);
        await userEvent.click(screen.getByRole("button", { name: "Filter entfernen" }));
        expect(onRemove).toHaveBeenCalledTimes(1);
    });
});

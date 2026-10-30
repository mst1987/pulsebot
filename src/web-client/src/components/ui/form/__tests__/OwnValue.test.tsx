// OwnValue (#918): "Eigener Wert auf <Server>" as a switch, the server's own
// field only while it is on, the shared default always below.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import OwnValue from "../OwnValue";
import { inLang } from "../../../../test/i18n";

const field = <input aria-label="Quote" defaultValue="5" />;

describe("OwnValue", () => {
    it("takes the shared default while the switch is off and hides the own field", () => {
        const { container } = render(<OwnValue server="Pulse Raids" own={false} onOwnChange={() => {}} fallback="10 Raider">{field}</OwnValue>);
        expect(screen.getByRole("switch", { name: "Eigener Wert auf Pulse Raids" })).not.toBeChecked();
        expect(screen.queryByLabelText("Quote")).toBeNull();
        expect(screen.getByText("Standard (alle Server)")).toBeInTheDocument();
        expect(screen.getByText("10 Raider")).toBeInTheDocument();
        expect(container.querySelector(".switch-row")).toHaveAttribute("data-tip-sub", expect.stringContaining("Pulse Raids"));
    });

    it("shows the own field while the switch is on and keeps the default below", () => {
        const { container } = render(<OwnValue server="Pulse Raids" own onOwnChange={() => {}} fallback="10 Raider">{field}</OwnValue>);
        expect(screen.getByRole("switch", { name: "Eigener Wert auf Pulse Raids" })).toBeChecked();
        expect(screen.getByLabelText("Quote")).toBeInTheDocument();
        expect(screen.getByText("10 Raider")).toBeInTheDocument();
        expect(container.querySelector(".own-value")).toHaveClass("is-own");
    });

    it("reports a flip of the switch", async () => {
        const onOwnChange = vi.fn();
        render(<OwnValue server="Pulse Raids" own={false} onOwnChange={onOwnChange} fallback="10">{field}</OwnValue>);
        await userEvent.click(screen.getByRole("switch"));
        expect(onOwnChange).toHaveBeenCalledWith(true);
    });

    it("says when no default is set", () => {
        render(<OwnValue server="A" own={false} onOwnChange={() => {}} fallback="">{field}</OwnValue>);
        expect(screen.getByText("nicht gesetzt")).toBeInTheDocument();
    });

    it("does not switch while disabled", async () => {
        const onOwnChange = vi.fn();
        render(<OwnValue server="A" own={false} disabled onOwnChange={onOwnChange} fallback="10">{field}</OwnValue>);
        await userEvent.click(screen.getByRole("switch"));
        expect(onOwnChange).not.toHaveBeenCalled();
    });

    it("speaks English once the page is switched", async () => {
        await inLang("en", () => {
            render(<OwnValue server="Pulse Raids" own={false} onOwnChange={() => {}} fallback={null}>{field}</OwnValue>);
            expect(screen.getByRole("switch", { name: "Own value on Pulse Raids" })).toBeInTheDocument();
            expect(screen.getByText("Default (all servers)")).toBeInTheDocument();
            expect(screen.getByText("not set")).toBeInTheDocument();
        });
    });
});

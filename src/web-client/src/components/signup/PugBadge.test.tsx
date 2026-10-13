import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { t } from "../../i18n";
import PugBadge from "./PugBadge";

// "PuG" only where the server says a raid is open to everyone (openToAll), with the reason as tooltip.
describe("PugBadge", () => {
    it("marks a raid open to everyone, the reason in its tooltip", () => {
        render(<PugBadge open />);
        const badge = screen.getByText(t("signups.pug.label"));
        expect(badge).toHaveAttribute("data-tip", t("signups.pug.tip"));
        expect(t("signups.pug.tip")).toBe("Offen für alle – keine Raider-Rolle nötig");
    });

    it("draws nothing for a category with raider roles", () => {
        const { container } = render(<PugBadge open={false} />);
        expect(container).toBeEmptyDOMElement();
        render(<PugBadge />);
        expect(screen.queryByText(t("signups.pug.label"))).not.toBeInTheDocument();
    });
});

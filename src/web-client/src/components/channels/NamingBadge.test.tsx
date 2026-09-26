// Where a channel name comes from (#285): one badge, the details in its tooltip.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import NamingBadge from "./NamingBadge";
import { t } from "../../i18n";
import type { ChannelNaming } from "../../api";

const naming = (over: Partial<ChannelNaming> = {}): ChannelNaming => ({
    source: "previous", label: "abgeleitet aus #mi-17-09-ssc", detail: "Datum ersetzt", design: "Rechte wie #mi-17-09-ssc",
    fromChannel: "c1", templateChannelId: "c1", templateChannelName: "mi-17-09-ssc", ...over,
});

describe("NamingBadge", () => {
    it("shows the label, detail and design in the tooltip", () => {
        render(<NamingBadge naming={naming()} />);
        const badge = screen.getByText("abgeleitet aus #mi-17-09-ssc");
        expect(badge).toHaveAttribute("data-tip", "abgeleitet aus #mi-17-09-ssc");
        expect(badge).toHaveAttribute("data-tip-sub", "Datum ersetzt · Rechte wie #mi-17-09-ssc");
        expect(badge).toHaveClass("accent");
    });

    it("leaves an empty part out of the tooltip", () => {
        render(<NamingBadge naming={naming({ source: "default", label: "Standard-Schema", detail: "", design: "einfacher Text-Kanal" })} />);
        const badge = screen.getByText("Standard-Schema");
        expect(badge).toHaveAttribute("data-tip-sub", "einfacher Text-Kanal");
        expect(badge).toHaveClass("mid");
    });

    it("shows only the kind in a list, the label in the tooltip", () => {
        render(<NamingBadge naming={naming()} short />);
        expect(t("raidCreate.naming.previous")).toBe("abgeleitet");
        expect(screen.getByText(t("raidCreate.naming.previous"))).toHaveAttribute("data-tip", "abgeleitet aus #mi-17-09-ssc");
    });

    it("shows nothing without a naming", () => {
        const { container } = render(<NamingBadge naming={null} />);
        expect(container).toBeEmptyDOMElement();
    });
});

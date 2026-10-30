// The app's own icons (#951): glyph, line icon and brand mark, decorative
// without a title, an image with one, and WowIcon switching to them by key.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Icon from "../Icon";
import WowIcon from "../WowIcon";

describe("Icon", () => {
    it("draws a glyph as inline SVG in its tone, decorative without a title", () => {
        const { container } = render(<Icon name="raids" size={20} />);
        const svg = container.querySelector("svg")!;
        expect(svg).toHaveAttribute("data-icon", "raids");
        expect(svg).toHaveClass("wi", "uic");
        expect(svg.getAttribute("class")).toMatch(/uic-(blood|bronze|arcane|fel)/);
        expect(svg).toHaveAttribute("aria-hidden", "true");
        expect(svg).toHaveAttribute("width", "20");
        expect(svg.querySelector("path")).toHaveAttribute("fill", "currentColor");
    });

    it("names the icon as an image when it carries a title", () => {
        render(<Icon name="settings" title="Einstellungen" />);
        const img = screen.getByRole("img", { name: "Einstellungen" });
        expect(img).toHaveAttribute("data-icon", "settings");
        expect(img.querySelector("title")).toHaveTextContent("Einstellungen");
    });

    it("strokes a line icon in the colour of its text", () => {
        const { container } = render(<Icon name="edit" />);
        const svg = container.querySelector("svg")!;
        expect(svg).toHaveClass("uic-line");
        expect(svg).toHaveAttribute("stroke", "currentColor");
        expect(svg).toHaveAttribute("fill", "none");
        expect(svg.querySelectorAll("path").length).toBeGreaterThan(0);
    });

    it("shows a brand as its own image and Discord as its inline mark", () => {
        const { container } = render(<><Icon name="warcraftLogs" /><Icon name="discord" title="Discord" /></>);
        const img = container.querySelector("img")!;
        expect(img).toHaveAttribute("src", "/brands/warcraftlogs.png");
        expect(img).toHaveAttribute("alt", "");
        expect(img).toHaveAttribute("aria-hidden", "true");
        expect(screen.getByRole("img", { name: "Discord" })).toHaveClass("uic-discord");
    });

    it("renders nothing for a name outside the set instead of throwing", () => {
        // menu.json is cast, so a typo there must not take the shell down
        const { container } = render(<Icon name={"noSuchIcon" as never} />);
        expect(container).toBeEmptyDOMElement();
    });

    it("lets WowIcon draw keys of the set and keep zamimg names for game content", () => {
        const { container } = render(<><WowIcon name="loot" size={18} /><WowIcon name="inv_misc_bag_10" size={18} /></>);
        expect(container.querySelector("[data-icon=loot]")).not.toBeNull();
        expect(container.querySelector("img[src*='inv_misc_bag_10']")).not.toBeNull();
    });
});

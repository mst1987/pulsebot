// The level of a note always as symbol and word (#980), the reason as a grey
// icon with its word as the name, "×2" from the second time on.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LevelMark from "./LevelMark";
import ReasonIcon, { ReasonIcons } from "./ReasonIcon";

describe("LevelMark", () => {
    it("shows symbol and word, the word as tooltip head", () => {
        const { container } = render(<LevelMark level="warning" />);
        expect(screen.getByText("Warnung")).toBeInTheDocument();
        const mark = container.querySelector(".nm-level")!;
        expect(mark).toHaveAttribute("data-level", "warning");
        expect(mark).toHaveAttribute("data-tip", "Warnung");
        expect(mark.querySelector("svg")).not.toBeNull();
    });

    it("names the symbol alone when only the icon shows", () => {
        render(<LevelMark level="shadowban" iconOnly />);
        expect(screen.getByRole("img", { name: "Shadowban" })).toBeInTheDocument();
        expect(screen.queryByText("Shadowban")).not.toBeInTheDocument();
    });

    it("says \"abgelaufen\" when nothing counts any more", () => {
        render(<LevelMark level={null} />);
        expect(screen.getByText("abgelaufen")).toBeInTheDocument();
    });
});

describe("ReasonIcon", () => {
    it("is an image named by its word, with the count from two on", () => {
        render(<ReasonIcons reasons={{ no_show: 2, loot: 1, behavior: 0 }} />);
        expect(screen.getByRole("img", { name: "Nicht erschienen ×2" })).toBeInTheDocument();
        expect(screen.getByRole("img", { name: "Loot" })).toBeInTheDocument();
        expect(screen.getAllByRole("img")).toHaveLength(2);
        expect(screen.getByText("×2")).toBeInTheDocument();
    });

    it("shows the word beside it and stays silent inside a chip", () => {
        const { container, rerender } = render(<ReasonIcon reason="behavior" withWord />);
        expect(screen.getByText("Verhalten")).toBeInTheDocument();
        expect(screen.queryByRole("img")).not.toBeInTheDocument();
        rerender(<ReasonIcon reason="behavior" decorative />);
        expect(container.querySelector(".nm-reason")).toHaveAttribute("aria-hidden", "true");
        expect(container.querySelector("[data-tip]")).toBeNull();
    });

    it("draws nothing without reasons", () => {
        const { container } = render(<ReasonIcons reasons={{}} />);
        expect(container).toBeEmptyDOMElement();
    });
});

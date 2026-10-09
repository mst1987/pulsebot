// The banner over an event of a hidden game version (#563).
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ArchiveBanner from "./ArchiveBanner";

const TBC = { versionId: "tbc", label: "TBC Anniversary", short: "TBC" };

describe("ArchiveBanner", () => {
    it("names the hidden version and says it is read only", () => {
        render(<ArchiveBanner archive={TBC} />);
        const note = screen.getByRole("note");
        expect(note).toHaveTextContent("Archiv · TBC");
        expect(note).toHaveTextContent("direkten Link");
        expect(note).toHaveTextContent("Nur lesen");
    });

    it("has its own line on the public raid plan", () => {
        render(<ArchiveBanner archive={TBC} publicView />);
        expect(screen.getByRole("note")).toHaveTextContent("Der Raidplan bleibt über den Link lesbar.");
    });

    it("is nothing for a normal event", () => {
        const { container } = render(<ArchiveBanner archive={null} />);
        expect(container).toBeEmptyDOMElement();
    });
});

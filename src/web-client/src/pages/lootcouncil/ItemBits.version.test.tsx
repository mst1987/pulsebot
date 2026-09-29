// The council's item links follow its version's Wowhead path (#542): TBC as
// before, another path when the server sends one, no link at all without one.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ItemLink } from "./ItemBits";
import { WowheadPathProvider } from "../../lib/versionLinks";

describe("ItemLink per game version (#542)", () => {
    it("links TBC without a provider, like every page before #542", () => {
        render(<ItemLink id={32837} name="Warglaive" />);
        expect(screen.getByRole("link", { name: "Warglaive" })).toHaveAttribute("href", "https://www.wowhead.com/tbc/item=32837");
    });

    it("links the version's path the server sent", () => {
        render(<WowheadPathProvider path="classic"><ItemLink id={19019} name="Thunderfury" /></WowheadPathProvider>);
        expect(screen.getByRole("link", { name: "Thunderfury" })).toHaveAttribute("href", "https://www.wowhead.com/classic/item=19019");
    });

    it("shows the item without a link when the version has no Wowhead path", () => {
        render(<WowheadPathProvider path=""><ItemLink id={19019} name="Thunderfury" /></WowheadPathProvider>);
        expect(screen.getByText("Thunderfury")).toBeInTheDocument();
        expect(screen.queryByRole("link")).toBeNull();
    });
});

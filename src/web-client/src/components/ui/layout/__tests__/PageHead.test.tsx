// The first two head levels (design issue #221): PageHead (which page) and
// PartHead (which part of the page), with the explanation in the title's tooltip.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PageHead from "../PageHead";
import { PartHead } from "../PartHead";

describe("PageHead", () => {
    it("names the page as its one heading, with kicker, meta and action", () => {
        render(<PageHead icon="inv_misc_map_01" kicker="3 Raid-Kategorien" title="Roster" meta={<span>2 doppelt</span>} action={<button type="button">Neu</button>} />);
        expect(screen.getByRole("heading", { level: 1, name: "Roster" })).toBeInTheDocument();
        expect(screen.getByText("3 Raid-Kategorien")).toBeInTheDocument();
        expect(screen.getByText("2 doppelt")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Neu" })).toBeInTheDocument();
    });

    it("leaves out what it was not given", () => {
        const { container } = render(<PageHead icon="inv_misc_map_01" title="Roster" />);
        expect(container.querySelector(".kicker, .ph-meta, .ph-act")).toBeNull();
    });
});

describe("PartHead", () => {
    it("explains itself in the title's tooltip instead of a paragraph, reachable by keyboard", () => {
        render(<PartHead title="Ausrüstung" crumb="Battle.net-Profil" tip="Ausrüstung" tipSub="Was der Charakter trägt" action={<button type="button">Neu laden</button>} />);
        const title = screen.getByText("Ausrüstung");
        expect(title).toHaveAttribute("data-tip", "Ausrüstung");
        expect(title).toHaveAttribute("data-tip-sub", "Was der Charakter trägt");
        expect(title).toHaveAttribute("tabindex", "0");
        expect(screen.getByText("Battle.net-Profil")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Neu laden" })).toBeInTheDocument();
    });

    it("is not focusable without a tip", () => {
        render(<PartHead title="Loot-Historie" />);
        expect(screen.getByText("Loot-Historie")).not.toHaveAttribute("tabindex");
    });

    it("plain: no icon tile, the count beside the title", () => {
        const { container } = render(<PartHead variant="plain" icon="inv_misc_map_01" title="Server" count="2 Server" action={<button type="button">Neu</button>} />);
        expect(container.querySelector(".part-head.is-plain")).not.toBeNull();
        expect(container.querySelector(".itile")).toBeNull();
        expect(container.querySelector(".ph-count")).toHaveTextContent("2 Server");
        expect(screen.getByRole("button", { name: "Neu" })).toBeInTheDocument();
    });

    it("shows a count only on the plain variant", () => {
        const { container } = render(<PartHead icon="inv_misc_map_01" title="Server" count="2 Server" />);
        expect(container.querySelector(".ph-count")).toBeNull();
        expect(container.querySelector(".itile")).not.toBeNull();
    });
});

// The mark of a note beside a name where the orga plans (#981): only the
// level's symbol, the level and the reasons with their counts as tooltip, a
// link to the person's notes only with read access to "vermerke" - and nothing
// at all without a short form (a raider's answer never carries one).
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import { adminUser, renderPage } from "../../../test/render";
import LevelMark from "../LevelMark";
import { reasonSummary, vermerkeHref } from "../markText";
import VermerkMark from "../VermerkMark";

const WARN = { level: "warning" as const, reasons: { late_signoff: 2, loot: 1 } };
const raider = adminUser({ isAdmin: false, access: {} });
const reader = adminUser({ isAdmin: false, access: { vermerke: { read: true, write: false } } });

describe("VermerkMark", () => {
    it("draws nothing without a short form or without a level", () => {
        const { container } = renderPage(<><VermerkMark userId="u1" /><VermerkMark userId="u1" short={null} /></>);
        expect(container.querySelector(".vm-mark")).toBeNull();
        expect(container.querySelector(".nm-level")).toBeNull();
    });

    it("shows only the symbol, the level as tooltip head and the reasons with their counts below", () => {
        const { container } = renderPage(<VermerkMark userId="u1" short={WARN} />, { user: raider });
        const mark = container.querySelector(".vm-mark .nm-level")!;
        expect(mark).toHaveAttribute("data-tip", "Warnung");
        expect(mark).toHaveAttribute("data-tip-sub", "Späte Abmeldung ×2 · Loot");
        expect(screen.getByRole("img", { name: t("vermerke.mark.aria", { summary: "Warnung · Späte Abmeldung ×2 · Loot" }) })).toBeInTheDocument();
        // no word beside the symbol
        expect(screen.queryByText("Warnung")).toBeNull();
    });

    it("links to the person's notes only with read access to \"vermerke\"", () => {
        const { unmount } = renderPage(<VermerkMark userId="123" short={WARN} />, { user: reader });
        expect(screen.getByRole("link")).toHaveAttribute("href", "/vermerke?user=123");
        unmount();
        renderPage(<VermerkMark userId="123" short={WARN} />, { user: raider });
        expect(screen.queryByRole("link")).toBeNull();
    });

    it("stays a plain symbol inside a row that is a button itself, and takes the access from the caller", () => {
        const { unmount } = renderPage(<VermerkMark userId="123" short={WARN} link={false} />, { user: adminUser() });
        expect(screen.queryByRole("link")).toBeNull();
        unmount();
        // outside the shell's outlet the caller says what the user may open
        render(<MemoryRouter><VermerkMark userId="123" short={WARN} canOpen /></MemoryRouter>);
        expect(screen.getByRole("link")).toHaveAttribute("href", "/vermerke?user=123");
    });

    it("reads a hint without reasons as the bare level", () => {
        const { container } = renderPage(<VermerkMark userId="u1" short={{ level: "hint", reasons: {} }} />, { user: raider });
        expect(container.querySelector(".nm-level")).toHaveAttribute("data-level", "hint");
        expect(screen.getByRole("img", { name: t("vermerke.mark.aria", { summary: "Hinweis" }) })).toBeInTheDocument();
    });
});

describe("reasonSummary / vermerkeHref", () => {
    it("lists the reasons in the fixed order, the count from two on", () => {
        expect(reasonSummary(t, { other: 1, no_show: 3, behavior: 0 })).toBe("Nicht erschienen ×3 · Sonstiges");
        expect(reasonSummary(t, {})).toBe("");
    });

    it("encodes the user id", () => {
        expect(vermerkeHref("a b")).toBe("/vermerke?user=a%20b");
    });
});

describe("LevelMark beside a name", () => {
    it("takes the reasons as the tooltip's second line and a name of its own", () => {
        render(<LevelMark level="shadowban" iconOnly tipSub="Verhalten" label="Vermerk: Shadowban" />);
        const img = screen.getByRole("img", { name: "Vermerk: Shadowban" });
        expect(img).toHaveAttribute("data-tip-sub", "Verhalten");
    });
});

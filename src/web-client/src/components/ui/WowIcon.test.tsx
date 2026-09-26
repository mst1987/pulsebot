// WoW icons (design issue #221): the zamimg url (lib/wowIcon.ts, twin of
// wowIconUrl() in src/config/menu.js), the icon itself, the icon tile and the bar.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import WowIcon from "./WowIcon";
import IconTile from "./IconTile";
import Bar from "./Bar";
import { FALLBACK_ICON, wowIconUrl } from "../../lib/wowIcon";
import { requireBackend } from "../../test/backend";

const backend = requireBackend<{ wowIconUrl: (name?: string | null, size?: number) => string; FALLBACK_ICON: string }>("config/menu");

describe("wowIconUrl", () => {
    it("builds the zamimg url, large by default and medium for small icons", () => {
        expect(wowIconUrl("inv_misc_map_01")).toBe("https://wow.zamimg.com/images/wow/icons/large/inv_misc_map_01.jpg");
        expect(wowIconUrl("inv_misc_map_01", 18)).toBe("https://wow.zamimg.com/images/wow/icons/medium/inv_misc_map_01.jpg");
        expect(wowIconUrl("inv_misc_map_01", 19)).toMatch(/\/large\//);
    });

    it("encodes the apostrophe that encodeURIComponent leaves alone", () => {
        expect(wowIconUrl("achievement_boss_kael'thassunstrider_01"))
            .toBe("https://wow.zamimg.com/images/wow/icons/large/achievement_boss_kael%27thassunstrider_01.jpg");
    });

    it("keeps a trailing suffix some names only exist with", () => {
        expect(wowIconUrl("achievement_boss_archimonde-")).toMatch(/\/achievement_boss_archimonde-\.jpg$/);
    });

    it("normalises case and a pasted .jpg, and falls back to the question mark", () => {
        expect(wowIconUrl("INV_Misc_Bag_10.jpg")).toMatch(/\/inv_misc_bag_10\.jpg$/);
        expect(wowIconUrl("")).toMatch(new RegExp(`/${FALLBACK_ICON}\\.jpg$`));
        expect(wowIconUrl(undefined)).toMatch(new RegExp(`/${FALLBACK_ICON}\\.jpg$`));
    });

    it("answers exactly like its server twin in src/config/menu.js", () => {
        expect(FALLBACK_ICON).toBe(backend.FALLBACK_ICON);
        const cases: [string | null | undefined, number | undefined][] = [
            ["inv_misc_map_01", undefined], ["inv_misc_map_01", 18], ["achievement_boss_kael'thassunstrider_01", 56],
            ["achievement_boss_archimonde-", 32], ["  INV_Misc_Bag_10.jpg ", 20], ["", undefined], [null, 18], [undefined, undefined],
            ["spell holy/äöü", 40],
        ];
        for (const [name, size] of cases) {
            expect({ name, url: wowIconUrl(name, size) }).toEqual({ name, url: backend.wowIconUrl(name, size) });
        }
    });
});

describe("WowIcon", () => {
    it("is a decorative image of the named icon, sized for its variant", () => {
        const { container } = render(<WowIcon name="inv_misc_map_01" size={18} />);
        const img = container.querySelector("img") as HTMLImageElement;
        expect(img).toHaveAttribute("alt", "");
        expect(img).toHaveAttribute("src", wowIconUrl("inv_misc_map_01", 18));
        expect(img).toHaveAttribute("width", "18");
    });

    it("falls back to the question mark when the CDN does not know the name", () => {
        const { container } = render(<WowIcon name="inv_does_not_exist" size={32} />);
        const img = container.querySelector("img") as HTMLImageElement;
        fireEvent.error(img);
        expect(img).toHaveAttribute("src", wowIconUrl(FALLBACK_ICON, 32));
    });
});

describe("IconTile", () => {
    it("is the .itile, never the dashboard's .tile, and hidden from screen readers", () => {
        const { container } = render(<IconTile icon="inv_misc_map_01" tone="roster" size="lg" />);
        const tile = container.firstElementChild as HTMLElement;
        expect(tile).toHaveClass("itile", "lg", "t-roster");
        expect(tile).not.toHaveClass("tile");
        expect(tile).toHaveAttribute("aria-hidden", "true");
        expect(tile.querySelector("img")).toHaveAttribute("src", wowIconUrl("inv_misc_map_01", 32));
    });

    it("takes a line icon node instead of a name", () => {
        render(<IconTile icon={<svg data-testid="line" />} />);
        expect(screen.getByTestId("line")).toBeInTheDocument();
    });
});

describe("Bar", () => {
    it("fills its share of max, clamped, with the rounded value as label", () => {
        const { container, rerender } = render(<Bar value={42.4} max={200} tone="ok" tip="42 von 200" />);
        const bar = container.firstElementChild as HTMLElement;
        expect(bar).toHaveClass("bar", "ok");
        expect(bar).toHaveAttribute("data-tip", "42 von 200");
        expect(bar.querySelector("i")).toHaveStyle({ "--fill": "21.2%" });
        expect(bar).toHaveTextContent("42");
        rerender(<Bar value={300} max={200} label="voll" />);
        expect(container.querySelector("i")).toHaveStyle({ "--fill": "100%" });
        expect(container.firstElementChild).toHaveTextContent("voll");
        rerender(<Bar value={5} max={0} />);
        expect(container.querySelector("i")).toHaveStyle({ "--fill": "0%" });
    });
});

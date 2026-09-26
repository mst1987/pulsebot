// The "Latest Loot" list of the start page and the Historie tab: one row per
// award, boss and date as one grey line, the winner explained in the tooltip.
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { TopLootAward } from "../../api";
import { t } from "../../i18n";
import { shortDate } from "../../lib/overviewDates";
import TopLootList from "./TopLootList";

function award(over: Partial<TopLootAward> = {}): TopLootAward {
    return {
        itemId: 32837,
        itemName: "Warglaive of Azzinoth",
        itemIconUrl: "https://wow.zamimg.com/images/wow/icons/large/inv_weapon_glave_01.jpg",
        itemQuality: 5,
        itemLink: "https://www.wowhead.com/tbc/item=32837",
        character: "Thrall",
        realm: "Thunderstrike",
        boss: "Illidan Stormrage",
        response: "BIS",
        offspec: false,
        reason: "ms",
        reasonLabel: "Main Spec",
        reasonTone: "ok",
        contentId: "bt",
        categoryId: "cat1",
        eventId: "1400",
        eventLabel: "Black Temple",
        awardedAt: Date.now(),
        className: "Warrior",
        spec: "Fury",
        classColor: "#c79c6e",
        specIconUrl: "",
        ...over,
    };
}

function show(items: TopLootAward[]) {
    return render(<MemoryRouter><TopLootList items={items} /></MemoryRouter>);
}

describe("Latest-Loot list", () => {
    it("writes boss and date as one grey line", () => {
        const at = Date.now();
        show([award({ awardedAt: at })]);
        expect(screen.getByText(`Illidan Stormrage · ${shortDate(at)}`)).toBeInTheDocument();
    });

    it("leaves out what is missing instead of a lone separator", () => {
        show([award({ boss: "", awardedAt: 0 }), award({ character: "Jaina", boss: "Archimonde", awardedAt: 0 })]);
        expect(screen.getByText("Archimonde")).toBeInTheDocument();
        expect(screen.queryByText(/·/)).not.toBeInTheDocument();
    });

    it("explains the winner with spec, class and the raw addon answer in the tooltip", () => {
        show([award()]);
        const tip = screen.getByRole("link", { name: "Thrall" }).closest("[data-tip]")!;
        expect(tip).toHaveAttribute("data-tip", "Thrall · Fury Warrior");
        expect(tip).toHaveAttribute("data-tip-sub", "Rückmeldung im Addon: „BIS“.");
    });

    it("says when the addon kept no answer", () => {
        show([award({ response: "", spec: "", className: "" })]);
        const tip = screen.getByRole("link", { name: "Thrall" }).closest("[data-tip]")!;
        expect(tip).toHaveAttribute("data-tip", "Thrall");
        expect(tip).toHaveAttribute("data-tip-sub", t("dashboard.topLoot.noResponse"));
    });

    it("leads the whole row to that raid's loot and keeps the item and character links", () => {
        const { container } = show([award({ eventId: "14 00" })]);
        expect(screen.getByRole("link", { name: t("dashboard.topLoot.openLoot", { event: "Black Temple" }) }))
            .toHaveAttribute("href", "/history/event?event=14%2000");
        expect(screen.getByRole("link", { name: "Warglaive of Azzinoth" })).toHaveAttribute("href", "https://www.wowhead.com/tbc/item=32837");
        expect(screen.getByRole("link", { name: "Thrall" })).toHaveAttribute("href", "/history/char?name=Thrall");
        expect(container.querySelectorAll("[title]")).toHaveLength(0);
    });
});

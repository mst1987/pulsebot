// "Vergaben" as a sortable table: the columns refetch with the server's sort,
// the reason is a status badge, the raid a select next to the search.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { LootAwardsData, TopLootAward } from "../../api";
import { renderPage } from "../../test/render";
import { LatestLootTab } from "./LatestLootTab";

vi.mock("../../api", async (orig) => ({ ...(await orig<typeof import("../../api")>()), getLootAwards: vi.fn() }));

const award = (over: Partial<TopLootAward> = {}): TopLootAward => ({
    itemId: 1, itemName: "Klinge des Verheerers", itemIconUrl: "", itemQuality: 4, itemLink: "", character: "Kaltstahl", realm: "",
    boss: "Illidan", response: "BiS", offspec: false, reason: "bis", reasonLabel: "BiS", reasonTone: "bis", contentId: "bt",
    categoryId: "", eventId: "e1", eventLabel: "Montag", awardedAt: Date.UTC(2026, 9, 3), className: "Warrior", spec: "Arms",
    classColor: "", specIconUrl: "", ...over,
});

const page = (items: TopLootAward[]): LootAwardsData => ({
    items, page: 1, pageSize: 25, total: items.length, totalPages: 1, topItemCount: 3,
    contents: [{ id: "bt", label: "Black Temple", short: "BT", tier: "t6" }], reasons: [{ id: "bis", label: "BiS", tone: "bis" }],
    unknownContentCount: 0,
} as unknown as LootAwardsData);

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getLootAwards).mockReset().mockResolvedValue(page([award(), award({ itemId: 2, itemName: "Krone", character: "Dunkelseele" })]));
});

describe("LatestLootTab", () => {
    it("lists the awards as a table with the reason as a badge and the raid by name", async () => {
        renderPage(<LatestLootTab categories={[]} />);
        expect(await screen.findByText("Klinge des Verheerers")).toBeInTheDocument();
        expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Datum", "Item", "Raider", "Grund", "Raid"]);
        expect(document.querySelector("td .rbadge.rbadge-bis")).not.toBeNull();
        expect(screen.getAllByText("Black Temple").length).toBeGreaterThan(0);
        expect(screen.getByText("2 Vergaben")).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Raid" })).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Grund" })).toBeInTheDocument();
    });

    it("asks the server to sort when a column head is clicked", async () => {
        const user = userEvent.setup();
        renderPage(<LatestLootTab categories={[]} />);
        await screen.findByText("Klinge des Verheerers");
        expect(api.getLootAwards).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "date", dir: "desc" }));

        await user.click(screen.getByRole("button", { name: "Item" }));
        await waitFor(() => expect(api.getLootAwards).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "item", dir: "asc" })));
        await user.click(screen.getByRole("button", { name: "Item" }));
        await waitFor(() => expect(api.getLootAwards).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "item", dir: "desc" })));
    });

    it("filters by raid through the select", async () => {
        const user = userEvent.setup();
        renderPage(<LatestLootTab categories={[]} />);
        await screen.findByText("Klinge des Verheerers");
        await user.selectOptions(screen.getByRole("combobox", { name: "Raid" }), "bt");
        await waitFor(() => expect(api.getLootAwards).toHaveBeenLastCalledWith(expect.objectContaining({ content: "bt" })));
    });
});

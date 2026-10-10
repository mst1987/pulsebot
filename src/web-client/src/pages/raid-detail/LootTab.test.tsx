// The raid detail's Loot tab (Oct 2026): every raider reads what the raid handed out,
// only the orga adds and deletes loot.
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LootItem } from "../../api";
import { t } from "../../i18n";
import { raidDetail } from "../../test/fixtures/raidDetail";
import { adminUser, renderPage } from "../../test/render";
import type { RaidCtx } from "./meta";
import LootTab from "./LootTab";

const item = (over: Partial<LootItem> = {}): LootItem => ({
    id: "l1", itemId: 30000, itemName: "Warglaive of Azzinoth", itemLink: "", character: "Illi", response: "", offspec: false,
    reason: "bis", reasonLabel: "BiS", reasonTone: "ok", contentId: "bt", tokenTier: "", boss: "Illidan", awardedAt: 0, source: "gargul",
    ...over,
} as LootItem);

function ctx(orga: boolean): RaidCtx {
    return {
        data: raidDetail({ lootItems: [item()] }), eventId: "own1", onChanged: vi.fn(), openModal: vi.fn(),
        orga, user: orga ? adminUser() : undefined,
    };
}

describe("LootTab", () => {
    it("lets the orga add, delete and clear loot", () => {
        renderPage(<LootTab ctx={ctx(true)} />);
        expect(screen.getByText("Warglaive of Azzinoth")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: t("raidDetail.loot.add") })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: t("raidDetail.loot.deleteEntry") })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: t("raidDetail.loot.clearButton") })).toBeInTheDocument();
    });

    it("shows a raider the loot without a single action", () => {
        renderPage(<LootTab ctx={ctx(false)} />);
        expect(screen.getByText("Warglaive of Azzinoth")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: t("raidDetail.loot.add") })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: t("raidDetail.loot.deleteEntry") })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: t("raidDetail.loot.clearButton") })).not.toBeInTheDocument();
    });
});

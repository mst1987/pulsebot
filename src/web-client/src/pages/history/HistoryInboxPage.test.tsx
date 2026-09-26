// The addon inbox page (/history/inbox): its head, the empty state and the
// link to the sync token settings — in German by default and in English.
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { HistoryData } from "../../api";
import { renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import HistoryInboxPage from "./HistoryInboxPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getHistoryData: vi.fn(),
    getLootInbox: vi.fn(),
}));

beforeEach(() => {
    vi.mocked(api.getHistoryData).mockResolvedValue({
        events: [], upcomingRaids: { events: [], error: null }, pastRaids: { events: [], error: null },
        lootEvents: [], logs: [], categories: [], categoryLootTool: {}, chars: [], activeGuildId: "g1",
    } as HistoryData);
    vi.mocked(api.getLootInbox).mockResolvedValue({ sessions: [], linked: [] });
});

afterEach(() => switchLang("de"));

describe("HistoryInboxPage", () => {
    it("says that nothing is waiting and where the sync token lives", async () => {
        renderPage(<HistoryInboxPage />, { route: "/history/inbox" });
        expect(await screen.findByText(/Keine offenen Addon-Uploads./)).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Addon-Inbox" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Sync-Token verwalten/ })).toHaveAttribute("href", "/settings?section=lootsync");
    });

    it("reads in English", async () => {
        await switchLang("en");
        renderPage(<HistoryInboxPage />, { route: "/history/inbox" });
        expect(await screen.findByText(/No open addon uploads./)).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Addon inbox" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Manage sync tokens/ })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Settings → Loot sync" })).toBeInTheDocument();
    });
});

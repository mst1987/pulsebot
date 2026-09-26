// "Historie & Loot" without write access (#435: formerly source scans in
// test/web-client/menuAccess.test.js): the read-only "loot" area sees the loot
// but gets no button that could only earn a 403 — no import, no category
// select, no "Item nachtragen", no delete — on the page, the event page and the
// character page alike. The API refuses those calls anyway.
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { HistoryCharData, HistoryData, HistoryEventData, LootItem, SessionUser } from "../../api";
import { adminUser, renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import HistoryCharPage from "./HistoryCharPage";
import HistoryEventPage from "./HistoryEventPage";
import HistoryPage from "./HistoryPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getHistoryData: vi.fn(),
    getHistoryEvent: vi.fn(),
    getHistoryChar: vi.fn(),
    getRosterChar: vi.fn(),
    getLootInbox: vi.fn(),
    getSession: vi.fn(),
}));

const lootOnly: SessionUser = { id: "u3", name: "Lou", isAdmin: false, access: { loot: { read: true, write: false } } };
const writer = adminUser();

const item = {
    id: "l1", itemId: 30102, itemName: "Krakenherz-Umhang", itemLink: "", character: "Ahri", response: "BIS",
    offspec: false, awardedAt: Date.UTC(2026, 8, 16), source: "gargul", eventId: "e1", eventLabel: "Karazhan",
} as unknown as LootItem;

beforeEach(() => {
    vi.mocked(api.getHistoryData).mockResolvedValue({
        events: [],
        upcomingRaids: { events: [], error: null },
        pastRaids: { events: [], error: null },
        lootEvents: [{ eventId: "e1", label: "Karazhan 16.09.", categoryId: "c1", count: 3, sources: ["gargul"], awardedAt: Date.UTC(2026, 8, 16) }],
        logs: [],
        categories: [{ id: "c1", name: "Raids Mittwoch" }],
        categoryLootTool: {},
        chars: [],
        activeGuildId: "g1",
    } as unknown as HistoryData);
    vi.mocked(api.getLootInbox).mockResolvedValue({ sessions: [] });
    vi.mocked(api.getSession).mockResolvedValue({ user: writer, csrfToken: null, areas: [], guilds: [], activeGuildId: "g1" });
    vi.mocked(api.getHistoryEvent).mockResolvedValue({ eventId: "e1", label: "Karazhan", items: [item] } as HistoryEventData);
    vi.mocked(api.getHistoryChar).mockResolvedValue({
        character: "Ahri", realm: "Thunderstrike", items: [item], armoryUrl: "", wclUrl: "", gear: null, gearConfigured: false,
        gearError: "", charSummary: null, gearNamespace: "", info: null, gearIssues: null,
    } as HistoryCharData);
    vi.mocked(api.getRosterChar).mockRejectedValue({ code: "http_403", message: "no" });
});

const deleteButton = () => screen.queryByRole("button", { name: /Krakenherz-Umhang/ });

describe("the history page's write actions", () => {
    it("files a raid's loot under a category only with write access", async () => {
        const view = renderPage(<HistoryPage />, { route: "/history?tab=loot", user: writer });
        expect(await screen.findByRole("combobox", { name: "Kategorie" })).toHaveValue("c1");
        expect(screen.getByRole("button", { name: "Loot importieren" })).toBeInTheDocument();
        view.unmount();

        renderPage(<HistoryPage />, { route: "/history?tab=loot", user: lootOnly });
        expect(await screen.findByText("Raids Mittwoch")).toBeInTheDocument();
        expect(screen.queryByRole("combobox", { name: "Kategorie" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Loot importieren" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Addon-Inbox/ })).not.toBeInTheDocument();
    });

    it("adds and deletes an event's loot only with write access", async () => {
        const view = renderPage(<HistoryEventPage />, { route: "/history/event?event=e1", user: writer });
        expect(await screen.findByRole("button", { name: "Loot löschen" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Item nachtragen" })).toBeInTheDocument();
        expect(deleteButton()).toBeInTheDocument();
        view.unmount();

        renderPage(<HistoryEventPage />, { route: "/history/event?event=e1", user: lootOnly });
        expect(await screen.findByText("Krakenherz-Umhang", { exact: false })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Loot löschen" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Item nachtragen" })).not.toBeInTheDocument();
        expect(deleteButton()).not.toBeInTheDocument();
    });

    it("deletes a character's loot row only with write access", async () => {
        const view = renderPage(<HistoryCharPage />, { route: "/history/char?name=Ahri&tab=loot", user: writer });
        expect(await screen.findByRole("heading", { name: "Ahri" })).toBeInTheDocument();
        expect(deleteButton()).toBeInTheDocument();
        view.unmount();

        renderPage(<HistoryCharPage />, { route: "/history/char?name=Ahri&tab=loot", user: lootOnly });
        expect(await screen.findByText("Krakenherz-Umhang", { exact: false })).toBeInTheDocument();
        expect(deleteButton()).not.toBeInTheDocument();
    });
});

describe("in English", () => {
    afterEach(() => switchLang("de"));

    it("labels the event page's write actions in English", async () => {
        await switchLang("en");
        renderPage(<HistoryEventPage />, { route: "/history/event?event=e1", user: writer });
        expect(await screen.findByRole("button", { name: "Delete loot" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Add item manually" })).toBeInTheDocument();
        expect(screen.getByText("History & loot · By raid")).toBeInTheDocument();
        expect(screen.getByText("1 item")).toBeInTheDocument();
    });

    it("labels the loot view's category select in English", async () => {
        await switchLang("en");
        renderPage(<HistoryPage />, { route: "/history?tab=loot", user: writer });
        expect(await screen.findByRole("combobox", { name: "Category" })).toHaveValue("c1");
        expect(screen.getByRole("option", { name: "— no category —" })).toBeInTheDocument();
        expect(screen.getByText("1 event")).toBeInTheDocument();
    });
});

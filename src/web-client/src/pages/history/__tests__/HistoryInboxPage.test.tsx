// The addon inbox page (/history/inbox): its head, the empty state and the
// link to the sync token settings — in German by default and in English.
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import type { HistoryData, InboxDismissedSession, InboxWaitingBank, InboxWaitingSession } from "../../../api";
import { adminUser, renderPage } from "../../../test/render";
import { switchLang } from "../../../test/i18n";
import HistoryInboxPage from "../HistoryInboxPage";

vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
    getHistoryData: vi.fn(),
    getLootInbox: vi.fn(),
    acceptLootInbox: vi.fn(),
    dismissLootInbox: vi.fn(),
    restoreLootInbox: vi.fn(),
    assignInboxBank: vi.fn(),
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
        expect(screen.getByRole("link", { name: /Sync-Token verwalten/ })).toHaveAttribute("href", "/settings/all?section=verbindungen");
    });

    // #957 review: the sync tokens live on "Alle Server", which only full admins open
    it("shows no token link to someone who is no full admin", async () => {
        renderPage(<HistoryInboxPage />, { route: "/history/inbox", user: adminUser({ isAdmin: false, access: { history: { read: true, write: true } } }) });
        expect(await screen.findByText(/Keine offenen Addon-Uploads./)).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: /Sync-Token verwalten/ })).toBeNull();
        expect(screen.queryAllByRole("link")).toHaveLength(0);
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

// #1002: uploads that found no raid by themselves wait for the orga of every
// candidate server; the first assignment wins, a dismissal stays for 14 days.
const DAY = 24 * 60 * 60 * 1000;

function waitingUpload(over: Partial<InboxWaitingSession> = {}): InboxWaitingSession {
    return {
        id: "w1", sessionId: "s1", receivedAt: Date.now() - 60_000, updatedAt: 0, startedAt: 0, endedAt: 0,
        instance: "Black Temple", contentLabel: "Black Temple", contentSource: "addon", contentMatched: 6,
        itemCount: 6, items: [], realm: "Thunderstrike", reporter: "Gemli", addonVersion: "1.16.0", tokenName: "Gemli",
        match: null, gameVersion: "tbc", waiting: true, servers: ["gA", "gB"],
        candidates: [
            { eventId: "evA", eventLabel: "BT Donnerstag", startTime: 1790000000, categoryId: "c1", categoryName: "Main", guildId: "gA", serverName: "Server A", ownServer: true, assignable: true, suggested: true, matched: 4, total: 7 },
            { eventId: "evB", eventLabel: "BT Twink", startTime: 1790003600, categoryId: "c2", categoryName: "PuG", guildId: "gB", serverName: "Server B", ownServer: false, assignable: false, suggested: false, matched: 3, total: 7 },
        ],
        ...over,
    };
}

const bank: InboxWaitingBank = {
    key: "tbc:thunderstrike:die gilde", gameVersion: "tbc", realm: "Thunderstrike", guild: "Die Gilde", faction: "Horde",
    receivedAt: Date.now(), uploadedBy: "Arthas", items: 120,
    servers: [{ guildId: "gA", name: "Server A", ownServer: true }, { guildId: "gB", name: "Server B", ownServer: false }],
};

/** The candidate line under a raid ("Server A · Main · 4 von 7 Teilnehmern"), spread over spans. */
const candidateLine = (re: RegExp) => screen.getByText((_, el) => el?.tagName === "SMALL" && re.test(el.textContent || ""));

const nonAdmin = () => adminUser({ isAdmin: false, access: { history: { read: true, write: true } } });

describe("HistoryInboxPage: Wartet auf Zuordnung", () => {
    beforeEach(() => {
        vi.mocked(api.getLootInbox).mockResolvedValue({ sessions: [], linked: [], waiting: [waitingUpload()], dismissed: [], waitingBanks: [] });
    });

    it("opens on the waiting tab and names each candidate with its server, participants and the suggestion", async () => {
        renderPage(<HistoryInboxPage />, { route: "/history/inbox" });
        expect(await screen.findByRole("radio", { name: "Wartet auf Zuordnung (1)" })).toHaveAttribute("aria-checked", "true");
        expect(screen.getByText("TBC · Thunderstrike · 6 Items · von Gemli")).toBeInTheDocument();
        expect(candidateLine(/^Server A · Main · 4 von 7 Teilnehmern$/)).toBeInTheDocument();
        expect(screen.getByText("Vorschlag")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /BT Donnerstag zuordnen/ })).toBeInTheDocument();
        // A raid of the other server: only its orga may assign it.
        expect(screen.queryByRole("button", { name: /BT Twink zuordnen/ })).toBeNull();
        expect(screen.getByText("nur Orga von Server B")).toBeInTheDocument();
        expect(screen.getByText(/Sichtbar für die Orga beider Server/)).toBeInTheDocument();
    });

    it("assigns the raid through the API", async () => {
        vi.mocked(api.acceptLootInbox).mockResolvedValue({ added: 6, eventLabel: "BT Donnerstag" } as Awaited<ReturnType<typeof api.acceptLootInbox>>);
        renderPage(<HistoryInboxPage />, { route: "/history/inbox" });
        fireEvent.click(await screen.findByRole("button", { name: /BT Donnerstag zuordnen/ }));
        expect(api.acceptLootInbox).toHaveBeenCalledWith({ id: "w1", event: "evA" });
        expect(await screen.findByRole("status")).toHaveTextContent(/BT Donnerstag/);
    });

    it("says plainly when another server was faster (409) and reloads", async () => {
        vi.mocked(api.acceptLootInbox).mockRejectedValue({ code: "already_assigned", message: "already" });
        renderPage(<HistoryInboxPage />, { route: "/history/inbox" });
        fireEvent.click(await screen.findByRole("button", { name: /BT Donnerstag zuordnen/ }));
        expect(await screen.findByRole("status")).toHaveTextContent(/Schon zugeordnet/);
        expect(vi.mocked(api.getLootInbox).mock.calls.length).toBeGreaterThan(1);
    });

    it("says plainly when the upload was dismissed meanwhile (409)", async () => {
        vi.mocked(api.acceptLootInbox).mockRejectedValue({ code: "already_dismissed", message: "dismissed" });
        renderPage(<HistoryInboxPage />, { route: "/history/inbox" });
        fireEvent.click(await screen.findByRole("button", { name: /BT Donnerstag zuordnen/ }));
        expect(await screen.findByRole("status")).toHaveTextContent(/Inzwischen verworfen/);
    });

    it("lets a full admin assign a raid of another server when the API allows it", async () => {
        const both = waitingUpload();
        both.candidates[1] = { ...both.candidates[1], assignable: true };
        vi.mocked(api.getLootInbox).mockResolvedValue({ sessions: [], linked: [], waiting: [both], dismissed: [], waitingBanks: [] });
        vi.mocked(api.acceptLootInbox).mockResolvedValue({ added: 1, eventLabel: "BT Twink" } as Awaited<ReturnType<typeof api.acceptLootInbox>>);
        renderPage(<HistoryInboxPage />, { route: "/history/inbox" });
        fireEvent.click(await screen.findByRole("button", { name: /BT Twink zuordnen/ }));
        expect(api.acceptLootInbox).toHaveBeenCalledWith({ id: "w1", event: "evB" });
        expect(await screen.findByRole("status")).toHaveTextContent("1 Item zu „BT Twink“ übernommen.");
    });

    it("names the version as the sync app does", async () => {
        vi.mocked(api.getLootInbox).mockResolvedValue({ sessions: [], linked: [], waiting: [waitingUpload({ versionShort: "TBC-A" })], dismissed: [], waitingBanks: [] });
        renderPage(<HistoryInboxPage />, { route: "/history/inbox" });
        expect(await screen.findByText("TBC-A · Thunderstrike · 6 Items · von Gemli")).toBeInTheDocument();
    });

    it("points from the empty Ready tab to the waiting uploads", async () => {
        renderPage(<HistoryInboxPage />, { route: "/history/inbox" });
        fireEvent.click(await screen.findByRole("radio", { name: "Bereit (0)" }));
        expect(screen.getByText("1 Upload wartet auf seinen Raid.")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: /Wartet auf Zuordnung“ öffnen/ }));
        expect(screen.getByRole("radio", { name: "Wartet auf Zuordnung (1)" })).toHaveAttribute("aria-checked", "true");
    });

    it("dismisses after asking", async () => {
        vi.mocked(api.dismissLootInbox).mockResolvedValue(undefined as never);
        renderPage(<HistoryInboxPage />, { route: "/history/inbox" });
        fireEvent.click(await screen.findByRole("button", { name: "Verwerfen" }));
        const dialog = await screen.findByRole("dialog");
        expect(dialog).toHaveTextContent(/Upload verwerfen\?/);
        expect(dialog).toHaveTextContent(/14 Tage/);
        fireEvent.click(within(dialog).getByRole("button", { name: /Verwerfen/ }));
        expect(await screen.findByRole("status")).toHaveTextContent("Upload verworfen.");
        expect(api.dismissLootInbox).toHaveBeenCalledWith("w1");
    });

    it("restores a dismissed upload and shows the days left", async () => {
        const dismissed: InboxDismissedSession = { ...waitingUpload({ id: "d1" }), dismissedAt: Date.now() - 4 * DAY, dismissedBy: "Admin" };
        vi.mocked(api.getLootInbox).mockResolvedValue({ sessions: [], linked: [], waiting: [], dismissed: [dismissed], waitingBanks: [] });
        vi.mocked(api.restoreLootInbox).mockResolvedValue({ id: "d1", sessionId: "s1", waiting: true });
        renderPage(<HistoryInboxPage />, { route: "/history/inbox" });
        fireEvent.click(await screen.findByRole("radio", { name: "Verworfen (1)" }));
        expect(screen.getByText("noch 10 Tage")).toBeInTheDocument();
        expect(screen.getByText(/verworfen von Admin/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Wiederherstellen" }));
        expect(api.restoreLootInbox).toHaveBeenCalledWith("d1");
        expect(await screen.findByRole("status")).toHaveTextContent("Upload wiederhergestellt.");
    });

    it("gives a waiting guild bank to the own server; a full admin may pick any listed server", async () => {
        vi.mocked(api.getLootInbox).mockResolvedValue({ sessions: [], linked: [], waiting: [], dismissed: [], waitingBanks: [bank] });
        vi.mocked(api.assignInboxBank).mockResolvedValue({ key: bank.key, guildId: "gA" });
        const { unmount } = renderPage(<HistoryInboxPage />, { route: "/history/inbox", user: nonAdmin() });
        expect(await screen.findByText("Gildenbank Die Gilde")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Zu Server B" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Zu Server A" }));
        expect(api.assignInboxBank).toHaveBeenCalledWith(bank.key, "gA");
        await screen.findByRole("status");
        unmount();

        renderPage(<HistoryInboxPage />, { route: "/history/inbox" });
        expect(await screen.findByRole("button", { name: "Zu Server B" })).toBeInTheDocument();
    });

    it("reads in English", async () => {
        await switchLang("en");
        renderPage(<HistoryInboxPage />, { route: "/history/inbox" });
        expect(await screen.findByRole("radio", { name: "Awaiting assignment (1)" })).toBeInTheDocument();
        expect(candidateLine(/^Server A · Main · 4 of 7 participants$/)).toBeInTheDocument();
        expect(screen.getByText("Only Server B's orga")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Assign BT Donnerstag/ })).toBeInTheDocument();
        expect(screen.getByText("Suggestion")).toBeInTheDocument();
        expect(screen.getByText(/Visible to the orga of both servers/)).toBeInTheDocument();
    });
});

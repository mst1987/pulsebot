// The guild bank's "Ausgegeben" tab against a mocked API: the tab with its
// count after "Warteliste", the hand-outs per day newest first (the order can
// be turned), to whom big, how and by whom, "aus der Warteliste", the filter
// line, and the empty state.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { renderPage } from "../../test/render";
import GuildBankPage from "./GuildBankPage";
import { bankData, bankItem } from "./guildBank.fixture";
import type { GuildBankHandedOut } from "../../api";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getGuildBank: vi.fn(),
    getGuildBankHandedOut: vi.fn(),
}));

const KEY = "tbc:spineshatter:die gilde";
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function out(over: Partial<GuildBankHandedOut> = {}): GuildBankHandedOut {
    return {
        id: "h1", itemId: 1, item: "Bold Living Ruby", iconUrl: "", amount: 2, userId: "u1", userName: "Anna", characterName: "Zibbo",
        realm: "Spine Shatter", purpose: "", createdAt: NOW - 3 * DAY, confirmedByName: "Arthas",
        handedOutAt: NOW - 1000, handedOutByName: "Jaina", handoutVia: "mail", fromWaitlist: false, ...over,
    };
}

const LIST = [
    out(),
    out({ id: "h2", itemId: 3, item: "Flask of Relentless Assault", amount: 5, userName: "Bo", characterName: "Bobo", realm: "", handedOutAt: NOW - DAY, handoutVia: "manual", handedOutByName: "Arthas", fromWaitlist: true }),
    out({ id: "h3", amount: 1, userName: "Cleo", characterName: "Cleo", realm: "", handedOutAt: NOW - 10 * DAY, handoutVia: "discord", handedOutByName: "Gemli" }),
];

async function openTab(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("tab", { name: /^Ausgegeben/ }));
}

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getGuildBank).mockResolvedValue(bankData({
        handedOutRequests: 3,
        items: [bankItem({ itemId: 1 }), bankItem({ itemId: 3, name: "Flask of Relentless Assault", group: "Fläschchen" })],
    }));
    vi.mocked(api.getGuildBankHandedOut).mockResolvedValue({ requests: LIST });
});

describe("guild bank: handed out", () => {
    it("has a tab after \"Warteliste\" with the count of the kept hand-outs", async () => {
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        const tabs = await screen.findAllByRole("tab");
        expect(tabs.map((tab) => tab.textContent)).toEqual(["Ausgebbar 2", "Warteliste 0", "Ausgegeben 3", "Nur Bestand 0", "Ausgeblendet 0", "Neu 0"]);
    });

    it("groups the hand-outs by day, newest first: to whom big, how, by whom, from the waiting list", async () => {
        const user = userEvent.setup();
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await openTab(user);
        const today = await screen.findByRole("region", { name: "Heute" });
        const regions = screen.getAllByRole("region");
        expect(regions.map((r) => r.getAttribute("aria-label")).slice(0, 2)).toEqual(["Heute", "Gestern"]);
        expect(regions).toHaveLength(3);
        expect(within(today).getByText("2× Bold Living Ruby")).toBeInTheDocument();
        expect(within(today).getByText("Zibbo-SpineShatter")).toBeInTheDocument();
        expect(within(today).getByText("Raider: Anna")).toBeInTheDocument();
        expect(within(today).getByText("per Post")).toBeInTheDocument();
        expect(within(today).getByText("von Jaina")).toBeInTheDocument();
        const yesterday = screen.getByRole("region", { name: "Gestern" });
        expect(within(yesterday).getByText("im Spiel abgehakt")).toBeInTheDocument();
        expect(within(yesterday).getByText("aus der Warteliste")).toBeInTheDocument();
        expect(within(regions[2]).getByText("im Discord")).toBeInTheDocument();
        expect(api.getGuildBankHandedOut).toHaveBeenCalledWith(KEY);
    });

    it("turns the order around and remembers it", async () => {
        const user = userEvent.setup();
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await openTab(user);
        await screen.findByRole("region", { name: "Heute" });
        await user.click(screen.getByRole("radio", { name: "Älteste zuerst" }));
        const labels = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
        expect(labels[labels.length - 1]).toBe("Heute");
        expect(localStorage.getItem("eh-guildbank-handedout-order")).toContain("old");
    });

    it("filters by item, character or raider and by category", async () => {
        const user = userEvent.setup();
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await openTab(user);
        await screen.findByRole("region", { name: "Heute" });
        await user.type(screen.getByRole("searchbox"), "bobo");
        expect(screen.getAllByRole("region")).toHaveLength(1);
        expect(screen.getByText("5× Flask of Relentless Assault")).toBeInTheDocument();
        await user.clear(screen.getByRole("searchbox"));
        await user.type(screen.getByRole("searchbox"), "nobody");
        expect(screen.getByText("Nichts gefunden.")).toBeInTheDocument();
        await user.clear(screen.getByRole("searchbox"));
        await user.click(screen.getByRole("button", { name: /Kategorie: Alle/ }));
        await user.selectOptions(screen.getByRole("combobox", { name: "Kategorie" }), "Fläschchen");
        expect(screen.getAllByRole("region")).toHaveLength(1);
    });

    it("says so when nothing was handed out yet", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getGuildBankHandedOut).mockResolvedValue({ requests: [] });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await openTab(user);
        expect(await screen.findByText(/^Noch nichts ausgegeben\./)).toBeInTheDocument();
    });
});

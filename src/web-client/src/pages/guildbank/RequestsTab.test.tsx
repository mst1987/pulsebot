// The guild bank's "Anfragen" tab against a mocked API: the tab with its count
// after "Warteliste", the requests grouped by status (set aside first, then
// open), the recipient big, since when / set aside by whom, "aus der
// Warteliste", the filter line, linking (kept from the old dialog), the head's
// "N Anfragen vorgemerkt" jump, no head button any more, and the popover of
// the item list's "Vorgemerkt" number.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { GuildBankRequest } from "../../api";
import { renderPage } from "../../test/render";
import GuildBankPage from "./GuildBankPage";
import { bankData } from "./guildBank.fixture";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getGuildBank: vi.fn(),
    getGuildBankRequests: vi.fn(),
    searchGuildBankCharacters: vi.fn(),
    linkGuildBankRequest: vi.fn(),
    verifyGuildBankRequest: vi.fn(),
    reassignGuildBankRequest: vi.fn(),
}));

const KEY = "tbc:spineshatter:die gilde";
const NOW = Date.now();
const HOUR = 60 * 60 * 1000;

function req(over: Partial<GuildBankRequest> = {}): GuildBankRequest {
    return {
        id: "r1", itemId: 1, item: "Bold Living Ruby", iconUrl: "https://example.test/ruby.jpg", amount: 2, userId: "u1", userName: "Anna",
        characterName: "Zibbi", realm: "Thunderstrike", purpose: "Gruul", status: "confirmed", createdAt: NOW - 5 * HOUR,
        handledByName: "Arthas", handledAt: NOW - 3 * HOUR, fromWaitlist: false, linked: true, ...over,
    };
}

const OPEN = req({
    id: "r2", itemId: 2, item: "Smooth Dawnstone", iconUrl: "", amount: 1, userId: "u2", userName: "Bo", characterName: "", realm: "",
    purpose: "", status: "open", createdAt: NOW - 30 * 60 * 1000, handledByName: "", handledAt: 0, linked: false, linkProblem: "none",
});
const WAITLIST = req({ id: "r3", itemId: 3, item: "Flask of Relentless Assault", amount: 5, userId: "u3", userName: "Cleo", characterName: "Cleo", realm: "", fromWaitlist: true, purpose: "" });

async function openTab(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("tab", { name: /^Anfragen/ }));
}

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getGuildBank).mockResolvedValue(bankData());
    vi.mocked(api.getGuildBankRequests).mockResolvedValue({ requests: [OPEN, req(), WAITLIST] });
});

describe("guild bank: requests tab", () => {
    it("sits after \"Warteliste\" with the count of the open and set-aside requests, and the head has no button for them any more", async () => {
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await waitFor(() => expect(screen.getByRole("tab", { name: /^Anfragen 3/ })).toBeInTheDocument());
        const tabs = screen.getAllByRole("tab");
        expect(tabs.map((tab) => tab.textContent)).toEqual(["Ausgebbar 3", "Warteliste 0", "Anfragen 3", "Ausgegeben 0", "Nur Bestand 1", "Ausgeblendet 1", "Neu 1"]);
        expect(screen.queryByRole("button", { name: "Anfragen" })).toBeNull();
        expect(api.getGuildBankRequests).toHaveBeenCalledWith(KEY);
    });

    it("groups by status, set aside first: recipient big, since when, set aside by whom, for what, from the waiting list", async () => {
        const user = userEvent.setup();
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await openTab(user);
        const reserved = await screen.findByRole("region", { name: "Vorgemerkt" });
        const open = screen.getByRole("region", { name: "Offen" });
        expect(reserved.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(within(reserved).getByText("wartet auf Ausgabe im Spiel")).toBeInTheDocument();
        expect(within(open).getByText("wartet auf die Orga")).toBeInTheDocument();
        const rows = within(reserved).getAllByRole("listitem");
        expect(rows).toHaveLength(2);
        expect(within(rows[0]).getByText("2× Bold Living Ruby")).toBeInTheDocument();
        expect(within(rows[0]).getByText("Zibbi-Thunderstrike")).toBeInTheDocument();
        expect(within(rows[0]).getByText(/^Raider: Anna/)).toBeInTheDocument();
        expect(within(rows[0]).getByText("vor 5 Std.")).toBeInTheDocument();
        expect(within(rows[0]).getByText("vorgemerkt von Arthas · vor 3 Std.")).toBeInTheDocument();
        expect(within(rows[0]).getByText(/Wofür: Gruul/)).toBeInTheDocument();
        expect(within(rows[0]).queryByText("aus der Warteliste")).toBeNull();
        expect(within(rows[1]).getByText("aus der Warteliste")).toBeInTheDocument();
        const openRow = within(open).getByRole("listitem");
        expect(within(openRow).getByText("nicht verknüpft")).toBeInTheDocument();
        expect(within(openRow).getByText("vor 30 Min.")).toBeInTheDocument();
        expect(screen.getByText(/^1 Anfrage ohne verknüpften Charakter/)).toBeInTheDocument();
    });

    it("filters by category and by item, character or raider", async () => {
        const user = userEvent.setup();
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await openTab(user);
        await screen.findByRole("region", { name: "Vorgemerkt" });
        await user.type(screen.getByPlaceholderText("Item oder Spieler"), "cleo");
        expect(screen.getByText("5× Flask of Relentless Assault")).toBeInTheDocument();
        expect(screen.queryByText("2× Bold Living Ruby")).toBeNull();
        expect(screen.queryByRole("region", { name: "Offen" })).toBeNull();
    });

    it("says so when nothing waits", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getGuildBankRequests).mockResolvedValue({ requests: [] });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await openTab(user);
        expect(await screen.findByText("Gerade wartet keine Anfrage.")).toBeInTheDocument();
    });

    it("jumps from the head's \"N Anfragen vorgemerkt\" to the tab", async () => {
        const user = userEvent.setup();
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await user.click(await screen.findByText("3 Anfragen vorgemerkt"));
        expect(screen.getByRole("tab", { name: /^Anfragen/ })).toHaveAttribute("aria-selected", "true");
        expect(await screen.findByRole("region", { name: "Vorgemerkt" })).toBeInTheDocument();
    });

    it("links a request to a profile character in a dialog and updates the row", async () => {
        const user = userEvent.setup();
        vi.mocked(api.searchGuildBankCharacters).mockResolvedValue({
            characters: [{
                userId: "u2", userName: "Bo", characterKey: "bobo", characterName: "Bobo", realm: "", className: "Druid",
                versionId: "tbc", icon: "", classColor: "", specKey: "", verified: true, evidence: "loot",
            }],
        });
        vi.mocked(api.linkGuildBankRequest).mockResolvedValue({ request: { ...OPEN, characterName: "Bobo", realm: "Spineshatter", linked: true, linkProblem: "" } });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await openTab(user);
        await user.click(await screen.findByRole("button", { name: "Verknüpfen: 1× Smooth Dawnstone" }));
        expect(screen.getByRole("textbox", { name: "Charakter oder Raider suchen" })).toHaveValue("Bo");
        await user.click(await screen.findByRole("button", { name: "Bobo von Bo wählen" }));
        expect(api.linkGuildBankRequest).toHaveBeenCalledWith(KEY, "r2", { userId: "u2", characterKey: "bobo" });
        const open = await screen.findByRole("region", { name: "Offen" });
        expect(await within(open).findByText("Bobo-Spineshatter")).toBeInTheDocument();
        expect(within(open).queryByText("nicht verknüpft")).toBeNull();
    });

    it("#806: checks the name of a request without a Discord account in game", async () => {
        const user = userEvent.setup();
        const open = req({
            id: "r3", itemId: 2, item: "Crimson Spinel", iconUrl: "", amount: 1, userId: "", userName: "Skerra", characterName: "Skerra",
            realm: "Thunderstrike", purpose: "", status: "open", handledByName: "", handledAt: 0, linked: false, linkProblem: "none",
        });
        vi.mocked(api.getGuildBankRequests).mockResolvedValue({ requests: [open] });
        vi.mocked(api.searchGuildBankCharacters).mockResolvedValue({ characters: [] });
        vi.mocked(api.verifyGuildBankRequest).mockResolvedValue({ request: { ...open, linked: true, linkProblem: "" } });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await openTab(user);
        await user.click(await screen.findByRole("button", { name: "Verknüpfen: 1× Crimson Spinel" }));
        await user.click(screen.getByRole("button", { name: "Skerra-Thunderstrike im Spiel geprüft" }));
        await user.click(screen.getByRole("button", { name: "Ja, gefunden" }));
        expect(api.verifyGuildBankRequest).toHaveBeenCalledWith(KEY, "r3");
        expect(await screen.findByText("Skerra-Thunderstrike ist im Spiel geprüft – die Anfrage kann bestätigt werden.")).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText("nicht verknüpft")).toBeNull());
    });

    it("#809: sends a request to another known name and puts it into the profile", async () => {
        const user = userEvent.setup();
        const open = req({
            id: "r4", itemId: 2, item: "Pyrestone", iconUrl: "", amount: 1, userId: "u3", userName: "Gentle", characterName: "Gentle",
            realm: "Thunderstrike", purpose: "", status: "open", handledByName: "", handledAt: 0, linked: false, linkProblem: "unverified",
        });
        vi.mocked(api.getGuildBankRequests).mockResolvedValue({ requests: [open] });
        vi.mocked(api.searchGuildBankCharacters).mockImplementation(async (_key, q) => ({
            characters: [],
            names: q.toLowerCase().startsWith("gentle") ? [{ name: "Gentletwowl", realm: "Thunderstrike", via: "bank" as const }] : [],
        }));
        vi.mocked(api.reassignGuildBankRequest).mockResolvedValue({ request: { ...open, characterName: "Gentletwowl", linked: true, linkProblem: "" }, profile: "added" });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await openTab(user);
        await user.click(await screen.findByRole("button", { name: "Verknüpfen: 1× Pyrestone" }));
        const others = await screen.findByRole("region", { name: "Andere Namen (ohne Raider-Profil)" });
        await user.click(within(others).getByRole("switch", { name: /Auch ins Profil von Gentle übernehmen/ }));
        await user.click(within(others).getByRole("button", { name: "Gentletwowl-Thunderstrike als Empfänger übernehmen" }));
        expect(api.reassignGuildBankRequest).toHaveBeenCalledWith(KEY, "r4", { characterName: "Gentletwowl", realm: "Thunderstrike", checked: false, addToProfile: true });
        expect(await screen.findByText("Geht jetzt an Gentletwowl-Thunderstrike. Im Profil von Gentle eingetragen.")).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText("Charakter nicht bestätigt")).toBeNull());
    });
});

describe("guild bank: the Vorgemerkt popover of the item list", () => {
    it("keeps a plain number while no set-aside request is known", async () => {
        vi.mocked(api.getGuildBankRequests).mockResolvedValue({ requests: [OPEN] });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await screen.findByRole("table", { name: "Gegenstände der Gildenbank" });
        expect(screen.queryByRole("button", { name: /vorgemerkt für Bold Living Ruby/ })).toBeNull();
    });

    it("lists who the number is for and jumps to the tab filtered by the item", async () => {
        const user = userEvent.setup();
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        const button = await screen.findByRole("button", { name: "4 vorgemerkt für Bold Living Ruby: für wen?" });
        expect(button).toHaveAttribute("aria-expanded", "false");
        await user.click(button);
        const pop = screen.getByRole("dialog", { name: "Vorgemerkt: Bold Living Ruby" });
        expect(button).toHaveAttribute("aria-expanded", "true");
        expect(within(pop).getByText("2× an Zibbi-Thunderstrike")).toBeInTheDocument();
        expect(within(pop).getByText("(Anna)")).toBeInTheDocument();
        // the panel takes the focus; Escape closes it and gives the focus back
        expect(pop).toHaveFocus();
        await user.keyboard("{Escape}");
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(button).toHaveFocus();

        await user.click(button);
        await user.click(screen.getByRole("button", { name: "Alle im Tab Anfragen" }));
        expect(screen.getByRole("tab", { name: /^Anfragen/ })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByPlaceholderText("Item oder Spieler")).toHaveValue("Bold Living Ruby");
        expect(await screen.findByText("2× Bold Living Ruby")).toBeInTheDocument();
        expect(screen.queryByText("5× Flask of Relentless Assault")).toBeNull();
    });

    it("shows at most six recipients, then \"+N weitere\"", async () => {
        const user = userEvent.setup();
        const many = Array.from({ length: 8 }, (_v, i) => req({ id: `m${i}`, characterName: `Char${i}`, userName: `Char${i}`, amount: 1, createdAt: NOW - (20 - i) * HOUR }));
        vi.mocked(api.getGuildBankRequests).mockResolvedValue({ requests: many });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await user.click(await screen.findByRole("button", { name: "4 vorgemerkt für Bold Living Ruby: für wen?" }));
        const pop = screen.getByRole("dialog");
        expect(within(pop).getAllByRole("listitem")).toHaveLength(6);
        expect(within(pop).getByText("+2 weitere")).toBeInTheDocument();
        expect(within(pop).getByText("1× an Char0-Thunderstrike")).toBeInTheDocument();
        expect(within(pop).queryByText("1× an Char7-Thunderstrike")).toBeNull();
    });
});

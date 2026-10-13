// The guild bank page against a mocked API: head, tabs, grouped list, the
// sorting switch, the item dialog, the bank-tab dialog, the empty state and
// the English texts.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { switchLang } from "../../test/i18n";
import { adminUser, CONTENT_ARIA, renderPage, twoVersions } from "../../test/render";
import { t } from "../../i18n";
import GuildBankPage from "./GuildBankPage";
import { bankData, bankItem } from "./guildBank.fixture";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getGuildBank: vi.fn(),
    setGuildBankItem: vi.fn(),
    setGuildBankTabHidden: vi.fn(),
    getGuildBankRequests: vi.fn(),
    searchGuildBankCharacters: vi.fn(),
    linkGuildBankRequest: vi.fn(),
    verifyGuildBankRequest: vi.fn(),
    reassignGuildBankRequest: vi.fn(),
}));

const KEY = "tbc:spineshatter:die gilde";

beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getGuildBank).mockResolvedValue(bankData());
});
afterEach(() => switchLang("de"));

describe("guild bank page", () => {
    it("heads the page with version, realm, scan and badges, and lists the requestable items by category", async () => {
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        expect(await screen.findByRole("heading", { name: "Gildenbank" })).toBeInTheDocument();
        expect(screen.getByText(/^TBC · Spineshatter · Stand .* · gescannt von Gemli$/)).toBeInTheDocument();
        expect(screen.getByText("4.812 g")).toBeInTheDocument();
        expect(screen.getByText("3 Bank-Tabs")).toBeInTheDocument();
        expect(screen.getByText("3 Anfragen vorgemerkt")).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: /Ausgebbar 3/ })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByRole("tab", { name: /Neu 1/ })).toBeInTheDocument();
        const table = screen.getByRole("table", { name: "Gegenstände der Gildenbank" });
        expect(within(table).getByText("Edelsteine")).toBeInTheDocument();
        expect(within(table).getByText("Fläschchen")).toBeInTheDocument();
        const ruby = within(table).getByRole("link", { name: "Bold Living Ruby" });
        expect(ruby).toHaveAttribute("href", "https://www.wowhead.com/tbc/item=1");
        expect(within(table).getAllByText("Tab 2: Edelsteine").length).toBe(2);
        expect(within(table).queryByText("Primal Might")).toBeNull();
        expect(api.getGuildBank).toHaveBeenCalledWith({ key: "", version: "" });
    });

    it("shows the new items with the notice and leaves out what lies only in hidden tabs", async () => {
        const user = userEvent.setup();
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await user.click(await screen.findByRole("tab", { name: /Neu/ }));
        expect(screen.getByText(/Seit dem letzten Scan neu in der Bank/)).toBeInTheDocument();
        expect(screen.getByText("Heroic Potion")).toBeInTheDocument();
        expect(screen.queryByText("Shadowcloth")).toBeNull();
    });

    it("sorts an item with the switch and moves it to its new tab", async () => {
        const user = userEvent.setup();
        vi.mocked(api.setGuildBankItem).mockResolvedValue({ item: bankItem({ itemId: 1, status: "show" }) });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        const group = await screen.findByRole("radiogroup", { name: "Einordnung von Bold Living Ruby" });
        expect(within(group).getByRole("radio", { name: "Ausgebbar" })).toHaveAttribute("aria-checked", "true");
        await user.click(within(group).getByRole("radio", { name: "Nur Bestand" }));
        expect(api.setGuildBankItem).toHaveBeenCalledWith(KEY, 1, { status: "show" });
        await waitFor(() => expect(screen.queryByText("Bold Living Ruby")).toBeNull());
        expect(screen.getByRole("tab", { name: /Nur Bestand 2/ })).toBeInTheDocument();
    });

    it("filters by category and search", async () => {
        const user = userEvent.setup();
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await user.click(await screen.findByRole("button", { name: /Kategorie: Alle/ }));
        await user.selectOptions(screen.getByRole("combobox", { name: "Kategorie" }), "Fläschchen");
        expect(screen.queryByText("Bold Living Ruby")).toBeNull();
        expect(screen.getByText("Flask of Relentless Assault")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /Kategorie: Fläschchen/ }));
        await user.selectOptions(screen.getByRole("combobox", { name: "Kategorie" }), "");
        await user.type(screen.getByPlaceholderText("Gegenstand suchen"), "smooth");
        expect(screen.getByText("Smooth Dawnstone")).toBeInTheDocument();
        expect(screen.queryByText("Bold Living Ruby")).toBeNull();
    });

    it("saves reserve, limit and category from the item dialog", async () => {
        const user = userEvent.setup();
        vi.mocked(api.setGuildBankItem).mockResolvedValue({ item: bankItem({ itemId: 1, reserve: 2, maxPerRequest: 5, reserved: 4, available: 4 }) });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await user.click(await screen.findByRole("button", { name: "Reserve und Höchstmenge: Bold Living Ruby" }));
        const reserve = screen.getByRole("textbox", { name: "Reserve" });
        await user.clear(reserve);
        await user.type(reserve, "x");
        expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
        await user.clear(reserve);
        await user.type(reserve, "2");
        const max = screen.getByRole("textbox", { name: "Höchstmenge pro Anfrage" });
        await user.clear(max);
        await user.type(max, "5");
        await user.type(screen.getByRole("textbox", { name: "Kategorie" }), " Raid ");
        // the portion per turn on the waiting list: 2 by default, − / + (never below 1)
        const portion = screen.getByRole("spinbutton", { name: "Portion pro Runde" });
        expect(portion).toHaveValue(2);
        expect(screen.getByText("Wer drankommt, bekommt höchstens so viele; der Rest stellt sich wieder hinten an.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Eine mehr pro Runde" }));
        await user.click(screen.getByRole("button", { name: "Eine mehr pro Runde" }));
        expect(portion).toHaveValue(4);
        await user.click(screen.getByRole("button", { name: "Eine weniger pro Runde" }));
        await user.clear(portion);
        await user.type(portion, "0");
        expect(portion).toHaveValue(0);
        await user.tab();
        expect(portion).toHaveValue(3);
        await user.click(screen.getByRole("button", { name: "Speichern" }));
        expect(api.setGuildBankItem).toHaveBeenCalledWith(KEY, 1, { reserve: 2, maxPerRequest: 5, portion: 3, category: "Raid" });
        await waitFor(() => expect(screen.queryByRole("textbox", { name: "Höchstmenge pro Anfrage" })).toBeNull());
    });

    it("hides a bank tab and reads the bank again", async () => {
        const user = userEvent.setup();
        vi.mocked(api.setGuildBankTabHidden).mockResolvedValue({ tabs: [] });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await user.click(await screen.findByRole("button", { name: "Bank-Tabs" }));
        const raid = screen.getByRole("switch", { name: "Tab 3: Raid" });
        expect(raid).toBeChecked();
        expect(screen.getByRole("switch", { name: "Tab 5: Lager" })).not.toBeChecked();
        await user.click(raid);
        expect(api.setGuildBankTabHidden).toHaveBeenCalledWith(KEY, 3, true);
        await waitFor(() => expect(api.getGuildBank).toHaveBeenCalledTimes(2));
    });

    it("lists the waiting requests in the 'Anfragen' dialog and reads the bank again when it closes", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getGuildBankRequests).mockResolvedValue({
            requests: [
                {
                    id: "r2", itemId: 2, item: "Smooth Dawnstone", iconUrl: "", amount: 1, userId: "u2", userName: "Bo", characterName: "",
                    realm: "", purpose: "", status: "open", createdAt: Date.UTC(2026, 9, 6, 18), handledByName: "", handledAt: 0, linked: false,
                },
                {
                    id: "r1", itemId: 1, item: "Bold Living Ruby", iconUrl: "https://example.test/ruby.jpg", amount: 2, userId: "u1",
                    userName: "Anna", characterName: "Zibbo", realm: "Spine Shatter", purpose: "Gruul", status: "confirmed",
                    createdAt: Date.UTC(2026, 9, 6, 17), handledByName: "Arthas", handledAt: 1, linked: true,
                },
            ],
        });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await user.click(await screen.findByRole("button", { name: "Anfragen" }));
        const list = await screen.findByRole("list", { name: "Anfragen" });
        const rows = within(list).getAllByRole("listitem");
        expect(rows).toHaveLength(2);
        expect(within(rows[0]).getByText("1× Smooth Dawnstone")).toBeInTheDocument();
        expect(within(rows[0]).getByText("Offen")).toBeInTheDocument();
        // no character: not linked, the orga cannot confirm it in Discord yet
        expect(within(rows[0]).getByText("nicht verknüpft")).toBeInTheDocument();
        expect(screen.getByText(/^1 Anfrage ohne verknüpften Charakter/)).toBeInTheDocument();
        expect(within(rows[1]).queryByText("nicht verknüpft")).toBeNull();
        expect(within(rows[1]).getByText("2× Bold Living Ruby")).toBeInTheDocument();
        expect(within(rows[1]).getByText(/^Anna · an Zibbo-SpineShatter · /)).toBeInTheDocument();
        expect(within(rows[1]).getByText("Wofür: Gruul")).toBeInTheDocument();
        expect(within(rows[1]).getByText("Vorgemerkt")).toBeInTheDocument();
        expect(api.getGuildBankRequests).toHaveBeenCalledWith(KEY);
        // the dialog's close button in its foot (the head has an "X" of the same name)
        const closers = screen.getAllByRole("button", { name: "Schließen" });
        await user.click(closers[closers.length - 1]);
        await waitFor(() => expect(api.getGuildBank).toHaveBeenCalledTimes(2));
    });

    it("links a request to a profile character inside the 'Anfragen' dialog", async () => {
        const user = userEvent.setup();
        const open = {
            id: "r2", itemId: 2, item: "Smooth Dawnstone", iconUrl: "", amount: 1, userId: "u2", userName: "Bo", characterName: "",
            realm: "", purpose: "", status: "open" as const, createdAt: Date.UTC(2026, 9, 6, 18), handledByName: "", handledAt: 0, linked: false,
        };
        vi.mocked(api.getGuildBankRequests).mockResolvedValue({ requests: [open] });
        vi.mocked(api.searchGuildBankCharacters).mockResolvedValue({
            characters: [{
                userId: "u2", userName: "Bo", characterKey: "bobo", characterName: "Bobo", realm: "", className: "Druid",
                versionId: "tbc", icon: "", classColor: "", specKey: "", verified: true, evidence: "loot",
            }],
        });
        vi.mocked(api.linkGuildBankRequest).mockResolvedValue({ request: { ...open, characterName: "Bobo", realm: "Spineshatter", linked: true } });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await user.click(await screen.findByRole("button", { name: "Anfragen" }));
        await user.click(await screen.findByRole("button", { name: "Verknüpfen: 1× Smooth Dawnstone" }));
        // the search in the same dialog, prefilled with the raider's name (no character yet)
        expect(screen.getByRole("textbox", { name: "Charakter oder Raider suchen" })).toHaveValue("Bo");
        await user.click(await screen.findByRole("button", { name: "Bobo von Bo wählen" }));
        expect(api.linkGuildBankRequest).toHaveBeenCalledWith(KEY, "r2", { userId: "u2", characterKey: "bobo" });
        const list = await screen.findByRole("list", { name: "Anfragen" });
        expect(within(list).getByText(/an Bobo-Spineshatter/)).toBeInTheDocument();
        expect(within(list).queryByText("nicht verknüpft")).toBeNull();
    });

    it("#806: checks the name of a request without a Discord account in game inside the 'Anfragen' dialog", async () => {
        const user = userEvent.setup();
        const open = {
            id: "r3", itemId: 2, item: "Crimson Spinel", iconUrl: "", amount: 1, userId: "", userName: "Skerra", characterName: "Skerra",
            realm: "Thunderstrike", purpose: "", status: "open" as const, createdAt: Date.UTC(2026, 9, 11, 18), handledByName: "", handledAt: 0,
            linked: false, linkProblem: "none" as const,
        };
        vi.mocked(api.getGuildBankRequests).mockResolvedValue({ requests: [open] });
        vi.mocked(api.searchGuildBankCharacters).mockResolvedValue({ characters: [] });
        vi.mocked(api.verifyGuildBankRequest).mockResolvedValue({ request: { ...open, linked: true, linkProblem: "" } });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await user.click(await screen.findByRole("button", { name: "Anfragen" }));
        await user.click(await screen.findByRole("button", { name: "Verknüpfen: 1× Crimson Spinel" }));
        await user.click(screen.getByRole("button", { name: "Skerra-Thunderstrike im Spiel geprüft" }));
        await user.click(screen.getByRole("button", { name: "Ja, gefunden" }));
        expect(api.verifyGuildBankRequest).toHaveBeenCalledWith(KEY, "r3");
        expect(await screen.findByText("Skerra-Thunderstrike ist im Spiel geprüft – die Anfrage kann bestätigt werden.")).toBeInTheDocument();
        const list = await screen.findByRole("list", { name: "Anfragen" });
        expect(within(list).queryByText("nicht verknüpft")).toBeNull();
    });
    it("#809: sends Gentle's request to Gentletwowl, a name the bank already mailed, and puts it into his profile", async () => {
        const user = userEvent.setup();
        const open = {
            id: "r4", itemId: 2, item: "Pyrestone", iconUrl: "", amount: 1, userId: "u3", userName: "Gentle", characterName: "Gentle",
            realm: "Thunderstrike", purpose: "", status: "open" as const, createdAt: Date.UTC(2026, 9, 12, 18), handledByName: "", handledAt: 0,
            linked: false, linkProblem: "unverified" as const,
        };
        vi.mocked(api.getGuildBankRequests).mockResolvedValue({ requests: [open] });
        vi.mocked(api.searchGuildBankCharacters).mockImplementation(async (_key, q) => ({
            characters: [],
            names: q.toLowerCase().startsWith("gentle") ? [{ name: "Gentletwowl", realm: "Thunderstrike", via: "bank" as const }] : [],
        }));
        vi.mocked(api.reassignGuildBankRequest).mockResolvedValue({ request: { ...open, characterName: "Gentletwowl", linked: true, linkProblem: "" }, profile: "added" });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await user.click(await screen.findByRole("button", { name: "Anfragen" }));
        await user.click(await screen.findByRole("button", { name: "Verknüpfen: 1× Pyrestone" }));
        const others = await screen.findByRole("region", { name: "Andere Namen (ohne Raider-Profil)" });
        expect(within(others).getByText("schon Gildenbank-Post bekommen")).toBeInTheDocument();
        await user.click(within(others).getByRole("switch", { name: /Auch ins Profil von Gentle übernehmen/ }));
        await user.click(within(others).getByRole("button", { name: "Gentletwowl-Thunderstrike als Empfänger übernehmen" }));
        expect(api.reassignGuildBankRequest).toHaveBeenCalledWith(KEY, "r4", { characterName: "Gentletwowl", realm: "Thunderstrike", checked: false, addToProfile: true });
        expect(await screen.findByText("Geht jetzt an Gentletwowl-Thunderstrike. Im Profil von Gentle eingetragen.")).toBeInTheDocument();
        const list = await screen.findByRole("list", { name: "Anfragen" });
        expect(within(list).queryByText("Charakter nicht bestätigt")).toBeNull();
    });

    it("#809: any other name only after 'Im Spiel geprüft' — no profile checkbox without a Discord account", async () => {
        const user = userEvent.setup();
        const open = {
            id: "r5", itemId: 2, item: "Crimson Spinel", iconUrl: "", amount: 1, userId: "", userName: "Skera", characterName: "Skera",
            realm: "Thunderstrike", purpose: "", status: "open" as const, createdAt: Date.UTC(2026, 9, 11, 18), handledByName: "", handledAt: 0,
            linked: false, linkProblem: "none" as const,
        };
        vi.mocked(api.getGuildBankRequests).mockResolvedValue({ requests: [open] });
        vi.mocked(api.searchGuildBankCharacters).mockResolvedValue({ characters: [], names: [] });
        vi.mocked(api.reassignGuildBankRequest).mockResolvedValue({ request: { ...open, characterName: "Skerra", linked: true, linkProblem: "" }, profile: "" });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await user.click(await screen.findByRole("button", { name: "Anfragen" }));
        await user.click(await screen.findByRole("button", { name: "Verknüpfen: 1× Crimson Spinel" }));
        const search = screen.getByRole("textbox", { name: "Charakter oder Raider suchen" });
        await user.clear(search);
        await user.type(search, "Skerra");
        const others = await screen.findByRole("region", { name: "Andere Namen (ohne Raider-Profil)" });
        expect(within(others).queryByRole("switch")).toBeNull();
        await user.click(await within(others).findByRole("button", { name: "Skerra im Spiel geprüft – als Empfänger übernehmen" }));
        expect(api.reassignGuildBankRequest).not.toHaveBeenCalled();
        await user.click(within(others).getByRole("button", { name: "Ja, gefunden" }));
        expect(api.reassignGuildBankRequest).toHaveBeenCalledWith(KEY, "r5", { characterName: "Skerra", realm: "", checked: true, addToProfile: false });
        expect(await screen.findByText("Geht jetzt an Skerra-Thunderstrike.")).toBeInTheDocument();
    });
    it("says so when no request waits", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getGuildBankRequests).mockResolvedValue({ requests: [] });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        await user.click(await screen.findByRole("button", { name: "Anfragen" }));
        expect(await screen.findByText("Gerade wartet keine Anfrage.")).toBeInTheDocument();
    });

    it("lets a reader look but not change", async () => {
        renderPage(<GuildBankPage />, { route: "/guildbank", user: adminUser({ isAdmin: false, access: { raids: { read: true, write: false } } }) });
        const group = await screen.findByRole("radiogroup", { name: "Einordnung von Bold Living Ruby" });
        expect(within(group).getByRole("radio", { name: "Nur Bestand" })).toBeDisabled();
        expect(screen.queryByRole("button", { name: /Reserve und Höchstmenge:/ })).toBeNull();
    });

    it("explains the addon and links the assignment when the server has no bank", async () => {
        vi.mocked(api.getGuildBank).mockResolvedValue({ banks: [], bank: null });
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        expect(await screen.findByText("Noch keine Gildenbank")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Zur Zuordnung" })).toHaveAttribute("href", "/settings?section=verbindungen");
    });

    // #741: the version decides — no bank of this version is no bank, the hint names the versions that have one
    it("says the shown version has no bank and names the versions that do", async () => {
        localStorage.removeItem("eh-content-version");
        vi.mocked(api.getGuildBank).mockResolvedValue({ banks: [], bank: null, otherVersions: ["Forever"] });
        renderPage(<GuildBankPage />, { route: "/guildbank", content: twoVersions() });
        expect(await screen.findByRole("heading", { name: "Noch keine Gildenbank für TBC" })).toBeInTheDocument();
        expect(screen.getByText("Dieser Server hat eine Gildenbank für Forever – oben in der Kopfleiste die Version umschalten.")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Zur Zuordnung" })).toBeInTheDocument();
    });

    it("asks for the content version's bank and offers a select with several banks of it", async () => {
        const user = userEvent.setup();
        localStorage.removeItem("eh-content-version");
        const banks = [
            { key: KEY, gameVersion: "tbc", versionShort: "TBC", realm: "Spineshatter", guild: "Die Gilde", scannedAt: 1 },
            { key: "tbc:spineshatter:zweite gilde", gameVersion: "tbc", versionShort: "TBC", realm: "Spineshatter", guild: "Zweite Gilde", scannedAt: 1 },
        ];
        vi.mocked(api.getGuildBank).mockResolvedValue(bankData({}, banks));
        renderPage(<GuildBankPage />, { route: "/guildbank", content: twoVersions() });
        expect(await screen.findByRole("heading", { name: "Gildenbank" })).toBeInTheDocument();
        expect(api.getGuildBank).toHaveBeenLastCalledWith({ key: "", version: "tbc" });
        await user.selectOptions(screen.getByLabelText("Gildenbank wählen"), "tbc:spineshatter:zweite gilde");
        await waitFor(() => expect(api.getGuildBank).toHaveBeenLastCalledWith({ key: "tbc:spineshatter:zweite gilde", version: "tbc" }));
        await user.click(within(screen.getByRole("radiogroup", { name: t(CONTENT_ARIA) })).getByRole("radio", { name: /Forever/ }));
        await waitFor(() => expect(api.getGuildBank).toHaveBeenLastCalledWith({ key: "", version: "forever" }));
    });

    it("speaks English", async () => {
        switchLang("en");
        renderPage(<GuildBankPage />, { route: "/guildbank" });
        expect(await screen.findByRole("heading", { name: "Guild bank" })).toBeInTheDocument();
        expect(screen.getByText("4,812 g")).toBeInTheDocument();
        expect(screen.getByText("3 requests set aside")).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: /Requestable 3/ })).toBeInTheDocument();
        expect(screen.getByText("Available = stock - set aside - reserve")).toBeInTheDocument();
    });
});

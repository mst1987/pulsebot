// System › Discord › Übersicht: the overview as the first tab, "Alles in Ordnung"
// or the points that need attention with their buttons, joins and leaves, the
// fixed messages, the bot check of the picked server, the bot offline, no server
// set, the server picker (#895) and the throttled "Neu prüfen" per server.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { DiscordOverview } from "../../api";
import { renderPage } from "../../test/render";
import { resetServerPickCache } from "../../hooks/useServerPick";
import DiscordOverviewPage from "./DiscordOverviewPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getDiscordOverview: vi.fn(),
    getDiscordTabCounts: vi.fn(),
    getServerChoices: vi.fn(),
}));

const SERVERS: api.DiscordServerChoice[] = [
    { guildId: "g1", name: "Testgilde", label: "", online: true, iconUrl: "" },
    { guildId: "g2", name: "Talkgilde", label: "Talk", online: true, iconUrl: "" },
];

function overview(over: Partial<DiscordOverview> = {}): DiscordOverview {
    return {
        guildId: "g1", online: true, members: [],
        botCheck: {
            guildId: "g1", known: true, channels: [], rolesAboveBot: [],
            functions: [
                { key: "posts", label: "Event-Posts, Anmelder-Nachricht, Setup, Pings", state: "ok", rights: [{ key: "SendMessages", label: "Nachrichten senden", ok: true }] },
                { key: "events", label: "Raids als Discord-Server-Event", state: "ok", rights: [{ key: "ManageEvents", label: "Ereignisse verwalten", ok: true }] },
            ],
        },
        messages: [],
        hygiene: { known: true, total: 12, empty: 0, aboveBot: 0, sensitive: 1 },
        ...over,
    };
}

const TALK = overview({
    guildId: "g2",
    botCheck: {
        guildId: "g2", known: true, channels: [], rolesAboveBot: [],
        functions: [
            { key: "posts", label: "Event-Posts, Anmelder-Nachricht, Setup, Pings", state: "missing", rights: [{ key: "SendMessages", label: "Nachrichten senden", ok: false }] },
            { key: "events", label: "Raids als Discord-Server-Event", state: "not_needed", rights: [{ key: "ManageEvents", label: "Ereignisse verwalten", ok: null }] },
        ],
    },
});
const NONE = overview({ guildId: "", botCheck: { guildId: "", known: false, functions: [], channels: [], rolesAboveBot: [] } });

const BUSY = overview({
    members: [
        { guildId: "g1", userId: "u7", name: "Thrall", at: Date.parse("2026-10-20T18:00:00Z"), kind: "join", roles: [], relation: { rosters: [{ id: "r1", name: "Naxx", categoryId: "c1", status: "roster" }], characters: 2 } },
        { guildId: "g1", userId: "u8", name: "Jaina", at: Date.parse("2026-10-19T18:00:00Z"), kind: "leave", roles: [], relation: { rosters: [], characters: 0 } },
    ],
    botCheck: {
        guildId: "g1", known: true, channels: [], rolesAboveBot: [],
        functions: [{ key: "roles", label: "Raider-Rollen, Rollen-Nachrichten, Rollen-Abgleich", state: "missing", rights: [{ key: "ManageRoles", label: "Rollen verwalten", ok: false }] }],
    },
    messages: [
        { kind: "roleMessage", kindLabel: "Rollen-Nachricht", title: "Berufe", categoryId: "", categoryName: "", guildId: "g1", channelId: "c1", channelName: "rollen", messageId: "m1", link: "", status: "deleted" },
        { kind: "addonCenter", kindLabel: "Addon-Zentrale", title: "", categoryId: "", categoryName: "", guildId: "g1", channelId: "c2", channelName: "addons", messageId: "m2", link: "https://discord.com/channels/g1/c2/m2", status: "ok" },
    ],
    hygiene: { known: true, total: 40, empty: 2, aboveBot: 0, sensitive: 1 },
});

let event: DiscordOverview;
let talk: DiscordOverview;

beforeEach(() => {
    localStorage.clear();
    event = overview();
    talk = TALK;
    resetServerPickCache();
    vi.mocked(api.getServerChoices).mockReset().mockResolvedValue(SERVERS);
    vi.mocked(api.getDiscordOverview).mockReset().mockImplementation(async (guildId) => (guildId === "g2" ? talk : event));
    vi.mocked(api.getDiscordTabCounts).mockReset().mockResolvedValue({ channels: 31, serverRoles: 5, roleMessages: 2 });
});

const open = () => renderPage(<DiscordOverviewPage />, { route: "/channels/overview" });

function SearchProbe() {
    const location = useLocation();
    return <span data-testid="search">{location.search}</span>;
}

describe("Discord-Übersicht", () => {
    it("is the first tab and says all is well when nothing is open", async () => {
        open();
        expect(await screen.findByText("Alles in Ordnung")).toBeInTheDocument();
        const tabs = screen.getByRole("navigation", { name: "Bereiche von Discord" });
        const links = within(tabs).getAllByRole("link");
        expect(links[0]).toHaveTextContent("Übersicht");
        expect(links[0]).toHaveAttribute("aria-current", "page");
        expect(screen.getByText("12 Rollen · 0 ohne Mitglieder · 1 mit heiklen Rechten")).toBeInTheDocument();
        expect(screen.getByText("In den letzten 7 Tagen ist niemand gekommen oder gegangen.")).toBeInTheDocument();
        expect(screen.getByText("Auf diesem Server steht keine feste Nachricht des Bots.")).toBeInTheDocument();
    });

    it("lists what needs attention with its buttons, joins and leaves and the messages", async () => {
        event = BUSY;
        open();
        const list = (await screen.findByRole("heading", { name: "Braucht Aufmerksamkeit" })).closest("section")!;
        expect(within(list).getByText("2 Punkte")).toBeInTheDocument();
        const rows = within(list).getAllByRole("listitem");
        expect(rows.map((r) => r.querySelector(".dov-att-status")!.textContent)).toEqual(["fehlt", "gelöscht"]);
        expect(within(rows[0]).getByRole("button", { name: "Recht prüfen" })).toBeInTheDocument();
        expect(within(rows[1]).getByRole("link", { name: "Neu posten" })).toHaveAttribute("href", "/channels/roles");
        // empty roles only in the hygiene line, no point of their own
        expect(within(list).getByText("40 Rollen · 2 ohne Mitglieder · 1 mit heiklen Rechten")).toBeInTheDocument();
        await userEvent.click(within(rows[0]).getByRole("button", { name: "Recht prüfen" }));

        expect(screen.getByText("1 neu · 1 gegangen")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Thrall" })).toHaveAttribute("href", "/channels/members?user=u7");
        expect(screen.getByText("Naxx")).toBeInTheDocument();
        expect(screen.getByText("nicht im Roster")).toBeInTheDocument();

        expect(screen.getByText("2 Nachrichten")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "In Discord öffnen" })).toHaveAttribute("href", "https://discord.com/channels/g1/c2/m2");
    });

    it("shows the bot check of the picked server in one column", async () => {
        open();
        const check = (await screen.findByRole("heading", { name: "Bot-Check" })).closest("section")!;
        expect(within(check).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
            expect.arrayContaining([expect.stringMatching(/Funktion/), expect.stringMatching(/Stand/)]),
        );
        expect(within(check).getAllByRole("columnheader")).toHaveLength(3);
        expect(within(check).getAllByText("ok")).toHaveLength(2);
    });

    it("shows the other server's bot check after picking it, sorted by state", async () => {
        const user = userEvent.setup();
        renderPage(<><DiscordOverviewPage /><SearchProbe /></>, { route: "/channels/overview" });
        await screen.findByText("Alles in Ordnung");
        expect(api.getDiscordOverview).toHaveBeenCalledWith("g1", false);
        await user.click(screen.getByRole("radio", { name: "Talkgilde" }));
        await waitFor(() => expect(api.getDiscordOverview).toHaveBeenLastCalledWith("g2", false));
        expect(screen.getByTestId("search")).toHaveTextContent(/^\?guild=g2$/);
        const check = (await screen.findByRole("heading", { name: "Bot-Check" })).closest("section")!;
        const posts = within(check).getByText("Event-Posts, Anmelder-Nachricht, Setup, Pings").closest("tr")!;
        expect(within(posts).getByText("fehlt")).toBeInTheDocument();
        expect(posts.querySelector(".dov-fn-missing")!.textContent).toBe("Nachrichten senden");
        expect(within(check).getByText("nicht nötig")).toBeInTheDocument();
        // sorted by state: the row with a missing right first
        expect(within(check).getAllByRole("row")[1]).toBe(posts);
    });

    it("opens the server from the link", async () => {
        renderPage(<DiscordOverviewPage />, { route: "/channels/overview?guild=g2" });
        expect(await screen.findByText("Recht fehlt: Nachrichten senden")).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: "Talkgilde" })).toBeChecked();
        expect(api.getDiscordOverview).not.toHaveBeenCalledWith("g1", false);
    });

    // #897: there is no talk server any more, an old link opens the first server
    it("opens the first server from an old talk-server link", async () => {
        renderPage(<DiscordOverviewPage />, { route: "/channels/overview?side=talk" });
        expect(await screen.findByRole("radio", { name: "Testgilde" })).toBeChecked();
        expect(api.getDiscordOverview).not.toHaveBeenCalledWith("g2", false);
    });

    it("says when no server is set and hides the picker", async () => {
        vi.mocked(api.getServerChoices).mockResolvedValue([]);
        event = NONE;
        open();
        expect(await screen.findByText(/Kein Server eingestellt/)).toBeInTheDocument();
        expect(api.getDiscordOverview).toHaveBeenCalledWith("", false);
        expect(screen.queryByRole("radiogroup", { name: "Server" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Neu prüfen/ })).toBeDisabled();
    });

    it("keeps the member links on the picked server", async () => {
        event = BUSY;
        talk = { ...BUSY, guildId: "g2" };
        renderPage(<DiscordOverviewPage />, { route: "/channels/overview?guild=g2" });
        expect(await screen.findByRole("link", { name: "Thrall" })).toHaveAttribute("href", "/channels/members?user=u7&guild=g2");
    });

    it("says when the bot is offline instead of listing points", async () => {
        event = overview({ online: false });
        open();
        expect(await screen.findAllByText("Bot offline")).not.toHaveLength(0);
        expect(screen.queryByText("Alles in Ordnung")).not.toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "Bot-Check" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Neu prüfen/ })).toBeDisabled();
    });

    it("asks Discord again at most every 30 seconds", async () => {
        open();
        await screen.findByText("Alles in Ordnung");
        expect(api.getDiscordOverview).toHaveBeenCalledWith("g1", false);
        await userEvent.click(screen.getByRole("button", { name: "Neu prüfen" }));
        await waitFor(() => expect(api.getDiscordOverview).toHaveBeenCalledWith("g1", true));
        const button = await screen.findByRole("button", { name: /Neu prüfen in \d+ s/ });
        expect(button).toBeDisabled();
    });

    it("asks afresh only for the server it was clicked on and keeps the wait per server", async () => {
        const user = userEvent.setup();
        open();
        await screen.findByText("Alles in Ordnung");
        await user.click(screen.getByRole("button", { name: "Neu prüfen" }));
        await waitFor(() => expect(api.getDiscordOverview).toHaveBeenCalledWith("g1", true));
        expect(await screen.findByRole("button", { name: /Neu prüfen in \d+ s/ })).toBeDisabled();
        // the other server has its own gap: it may be checked right away
        await user.click(screen.getByRole("radio", { name: "Talkgilde" }));
        expect(await screen.findByText("Recht fehlt: Nachrichten senden")).toBeInTheDocument();
        expect(api.getDiscordOverview).not.toHaveBeenCalledWith("g2", true);
        expect(screen.getByRole("button", { name: "Neu prüfen" })).toBeEnabled();
        // back to the first server: its wait is still running
        await user.click(screen.getByRole("radio", { name: "Testgilde" }));
        await screen.findByText("Alles in Ordnung");
        expect(screen.getByRole("button", { name: /Neu prüfen in \d+ s/ })).toBeDisabled();
    });

    it("says the bot cannot check instead of all being well when it is not on the server", async () => {
        event = overview({ botCheck: { guildId: "g1", known: false, functions: [], channels: [], rolesAboveBot: [] } });
        open();
        expect(await screen.findByText("nicht prüfbar")).toBeInTheDocument();
        expect(screen.queryByText("Alles in Ordnung")).not.toBeInTheDocument();
    });

    it("counts the messages the bot could not check in one calm line", async () => {
        event = overview({
            messages: [
                { kind: "addonCenter", kindLabel: "Addon-Zentrale", title: "", categoryId: "", categoryName: "", guildId: "g1", channelId: "c2", channelName: "addons", messageId: "m2", link: "", status: "unknown" },
            ],
        });
        open();
        expect(await screen.findByText("1 Nachricht nicht geprüft")).toBeInTheDocument();
        expect(screen.getByText("Alles in Ordnung")).toBeInTheDocument();
    });

    it("folds the fine functions into one line that opens", async () => {
        event = overview({
            botCheck: {
                guildId: "g1", known: true, channels: [], rolesAboveBot: [],
                functions: [TALK.botCheck.functions[0], overview().botCheck.functions[1]],
            },
        });
        open();
        const check = (await screen.findByRole("heading", { name: "Bot-Check" })).closest("section")!;
        const fold = await within(check).findByRole("button", { name: "1 Funktion ok" });
        expect(fold).toHaveAttribute("aria-expanded", "false");
        const fine = within(check).getByText("Raids als Discord-Server-Event").closest("tr")!;
        expect(fine).toHaveClass("dov-fn-okrow");
        expect(within(check).getByText("Event-Posts, Anmelder-Nachricht, Setup, Pings").closest("tr")).not.toHaveClass("dov-fn-okrow");
        await userEvent.click(fold);
        expect(fold).toHaveAttribute("aria-expanded", "true");
        expect(check.querySelector("table")).toHaveClass("dov-fn-open");
    });
});

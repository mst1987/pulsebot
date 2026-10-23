// System › Discord › Übersicht: the overview as the first tab, "Alles in Ordnung"
// or the points that need attention with their buttons, joins and leaves, the
// fixed messages, the bot check of both servers, the bot offline, a talk server
// that is not set up, and the throttled "Neu prüfen".
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { DiscordOverview } from "../../api";
import { adminUser, renderPage } from "../../test/render";
import DiscordOverviewPage from "./DiscordOverviewPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getDiscordOverview: vi.fn(),
    getDiscordTabCounts: vi.fn(),
}));

function overview(over: Partial<DiscordOverview> = {}): DiscordOverview {
    return {
        side: "event", guildId: "g1", online: true, members: [],
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
    side: "talk", guildId: "g2",
    botCheck: {
        guildId: "g2", known: true, channels: [], rolesAboveBot: [],
        functions: [
            { key: "posts", label: "Event-Posts, Anmelder-Nachricht, Setup, Pings", state: "missing", rights: [{ key: "SendMessages", label: "Nachrichten senden", ok: false }] },
            { key: "events", label: "Raids als Discord-Server-Event", state: "not_needed", rights: [{ key: "ManageEvents", label: "Ereignisse verwalten", ok: null }] },
        ],
    },
});
const NO_TALK = overview({ side: "talk", guildId: "", botCheck: { guildId: "", known: false, functions: [], channels: [], rolesAboveBot: [] } });

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
    vi.mocked(api.getDiscordOverview).mockReset().mockImplementation(async (side) => (side === "talk" ? talk : event));
    vi.mocked(api.getDiscordTabCounts).mockReset().mockResolvedValue({ channels: 31, serverRoles: 5, roleMessages: 2 });
});

const open = () => renderPage(<DiscordOverviewPage />, { route: "/channels/overview" });

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
        expect(within(list).getByText("3 Punkte")).toBeInTheDocument();
        const rows = within(list).getAllByRole("listitem");
        expect(rows.map((r) => r.querySelector(".dov-att-status")!.textContent)).toEqual(["fehlt", "gelöscht", "Aufräumen"]);
        expect(within(rows[0]).getByRole("button", { name: "Recht prüfen" })).toBeInTheDocument();
        expect(within(rows[1]).getByRole("link", { name: "Neu posten" })).toHaveAttribute("href", "/channels/roles");
        expect(within(rows[2]).getByText("2 Rollen ohne Mitglieder")).toBeInTheDocument();
        await userEvent.click(within(rows[0]).getByRole("button", { name: "Recht prüfen" }));

        expect(screen.getByText("1 neu · 1 gegangen")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Thrall" })).toHaveAttribute("href", "/channels/members?user=u7");
        expect(screen.getByText("Naxx")).toBeInTheDocument();
        expect(screen.getByText("nicht im Roster")).toBeInTheDocument();

        expect(screen.getByText("2 Nachrichten")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "In Discord öffnen" })).toHaveAttribute("href", "https://discord.com/channels/g1/c2/m2");
    });

    it("shows the bot check of both servers side by side", async () => {
        open();
        const check = (await screen.findByRole("heading", { name: "Bot-Check" })).closest("section")!;
        await waitFor(() => expect(within(check).getAllByRole("columnheader")).toHaveLength(4));
        const posts = within(check).getByText("Event-Posts, Anmelder-Nachricht, Setup, Pings").closest("tr")!;
        expect(within(posts).getByText("ok")).toBeInTheDocument();
        expect(within(posts).getByText("fehlt")).toBeInTheDocument();
        expect(posts.querySelector(".dov-fn-missing")!.textContent).toBe("Nachrichten senden");
        expect(within(check).getByText("nicht nötig")).toBeInTheDocument();
        // sorted by state: the row with a missing right first
        expect(within(check).getAllByRole("row")[1]).toBe(posts);
    });

    it("leaves the talk column out when the talk server is not set up", async () => {
        talk = NO_TALK;
        open();
        const check = (await screen.findByRole("heading", { name: "Bot-Check" })).closest("section")!;
        await waitFor(() => expect(api.getDiscordOverview).toHaveBeenCalledWith("talk"));
        expect(within(check).getAllByRole("columnheader")).toHaveLength(3);
        await userEvent.click(screen.getByRole("radio", { name: "Talk-Server" }));
        expect(await screen.findByText(/kein Talk-Server/i)).toBeInTheDocument();
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
        expect(api.getDiscordOverview).toHaveBeenCalledWith("event", false);
        await userEvent.click(screen.getByRole("button", { name: "Neu prüfen" }));
        await waitFor(() => expect(api.getDiscordOverview).toHaveBeenCalledWith("event", true));
        const button = await screen.findByRole("button", { name: /Neu prüfen in \d+ s/ });
        expect(button).toBeDisabled();
    });

    it("shows a member as plain text to an account without the channels area", async () => {
        event = BUSY;
        renderPage(<DiscordOverviewPage />, { route: "/channels/overview", user: adminUser({ isAdmin: false, access: { roster: { read: true, write: false } } }) });
        expect(await screen.findByText("Thrall")).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Thrall" })).not.toBeInTheDocument();
    });
});

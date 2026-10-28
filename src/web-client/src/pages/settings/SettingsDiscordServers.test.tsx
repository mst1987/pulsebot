// Einstellungen → Discord-Server (#891): the links table with create/remove,
// the hint for a source without a raid category, and the guild bank channel.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { AdminConfig, DiscordServersData, ServerLink, ServerRow } from "../../api";
import { renderPage } from "../../test/render";
import DiscordServersSection from "./SettingsDiscordServers";
import PugOnboardingPart from "./PugOnboardingPart";
import { useLocation } from "react-router-dom";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getDiscordServers: vi.fn(),
    getPugInvites: vi.fn(),
    postPugInvite: vi.fn(),
    getTalkOverview: vi.fn(),
    repostTalkOverview: vi.fn(),
    getRoleSync: vi.fn(),
    getReminders: vi.fn(),
    getPugOnboarding: vi.fn(),
    updateSettings: vi.fn(),
}));

function row(id: string, name: string, raidCategories: number): ServerRow {
    return {
        role: "event", id, name, connected: true, memberCount: 12, iconUrl: "",
        permissions: null, missing: [], label: "", raidCategories, lang: "",
    } as ServerRow;
}

function serversData({ links = [], raidCategories = 2, guildBankChannelId = "", signupNoteChannelId = "", pug = false }: {
    links?: ServerLink[]; raidCategories?: number; guildBankChannelId?: string; signupNoteChannelId?: string; pug?: boolean;
} = {}): DiscordServersData {
    return {
        discordServers: {
            servers: [{ guildId: "10001", label: "", ...(pug ? { pug: true } : {}) }],
            links,
        },
        // #924: the two signup channels belong to each server
        channels: { "10001": { signupNoteChannelId, guildBankChannelId } },
        servers: [row("10001", "Pulse", raidCategories)],
        guilds: [
            { id: "10001", name: "Pulse", lang: "de", channels: [{ id: "c1", name: "orga-gildenbank", category: "Orga" }] },
            { id: "20002", name: "Eventserver", lang: "en", channels: [{ id: "c2", name: "raids", category: "Events" }] },
        ],
        versions: [{ id: "tbc", label: "TBC Anniversary", short: "TBC" }, { id: "forever", label: "WoW Forever", short: "Forever" }],
    };
}

const LINK: ServerLink = { from: "10001", to: "20002", channelId: "c2", lang: "en", versions: ["tbc"] };

// design B: every part sits on a tab; the tab comes from ?tab= like a deep link
const render = (tab = "") => renderPage(<DiscordServersSection onConfig={() => undefined} crumb="Verbindungen" />, { route: tab ? `/?tab=${tab}` : "/" });

beforeEach(() => {
    vi.mocked(api.getTalkOverview).mockResolvedValue({ statuses: [] });
    // #896: the role sync part mounts with a single server as well
    vi.mocked(api.getRoleSync).mockResolvedValue({ roleSync: [], servers: [], overlaps: [], drift: [], driftTotal: 0, driftError: null, lastRun: null });
    vi.mocked(api.getReminders).mockResolvedValue({ categoryReminders: {}, categories: [], lastRun: null });
    vi.mocked(api.updateSettings).mockReset();
    vi.mocked(api.updateSettings).mockResolvedValue({ config: {} as AdminConfig });
    vi.mocked(api.getPugInvites).mockResolvedValue({ links: [], servers: [] });
    vi.mocked(api.postPugInvite).mockReset();
    vi.mocked(api.getPugOnboarding).mockReset();
    vi.mocked(api.getPugOnboarding).mockReturnValue(new Promise(() => undefined));
});

describe("Discord-Server: Schalter PuG-Server (#906)", () => {
    const HINT = /Kein PuG-Server – Rollen & Onboarding gibt es nur auf Servern mit dem Schalter/;

    it("shows only the hint in Rollen & Onboarding while no server is a PuG server", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData());
        render("roles");
        expect(await screen.findByText(HINT)).toBeInTheDocument();
        expect(api.getPugOnboarding).not.toHaveBeenCalled();
        // nothing to apply without a PuG server
        expect(screen.queryByRole("button", { name: "In Discord übernehmen" })).toBeNull();
    });

    it("loads Rollen & Onboarding for a PuG server and names it in the server row", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ pug: true }));
        render("roles");
        await waitFor(() => expect(api.getPugOnboarding).toHaveBeenCalled());
        // the server row sits on the tab Server
        fireEvent.click(screen.getByRole("tab", { name: /^Server/ }));
        await waitFor(() => expect(document.querySelector(".srv-sub")).not.toBeNull());
        expect(document.querySelector(".srv-sub")?.textContent).toContain("PuG-Server");
        expect(screen.queryByText(HINT)).toBeNull();
    });

    it("shows the hint when the API says the server is no PuG server", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ pug: true }));
        vi.mocked(api.getPugOnboarding).mockResolvedValue({
            guildId: "10001", guildName: "Pulse", online: true, applied: null, notPugServer: true,
        } as unknown as api.PugOnboardingOverview);
        render("roles");
        expect(await screen.findByText(HINT)).toBeInTheDocument();
    });

    it("drops a slow answer that arrives after the answer for a server chosen later", async () => {
        const overview = (guildId: string, other: string) => ({
            guildId, guildName: other, online: true, applied: null, pugCategories: [], otherCategories: [{ id: `c${guildId}`, name: other }],
        } as unknown as api.PugOnboardingOverview);
        let first: (v: api.PugOnboardingOverview) => void = () => undefined;
        let second: (v: api.PugOnboardingOverview) => void = () => undefined;
        vi.mocked(api.getPugOnboarding)
            .mockReturnValueOnce(new Promise((r) => { first = r; }))
            .mockReturnValueOnce(new Promise((r) => { second = r; }));
        renderPage(<PugOnboardingPart servers={[
            { id: "10001", name: "Pulse", label: "" },
            { id: "20002", name: "Eventserver", label: "" },
        ]} />);
        // the default load (no guildId) is still open when the admin picks the second server
        fireEvent.change(await screen.findByRole("combobox", { name: "Server" }), { target: { value: "20002" } });
        await waitFor(() => expect(api.getPugOnboarding).toHaveBeenCalledTimes(2));
        await act(async () => { second(overview("20002", "Neue Kategorie")); });
        expect(await screen.findByText(/Neue Kategorie/)).toBeInTheDocument();
        // now the old answer for the default server comes in late: it must change nothing
        await act(async () => { first(overview("10001", "Alte Kategorie")); });
        expect(screen.getByText(/Neue Kategorie/)).toBeInTheDocument();
        expect(screen.queryByText(/Alte Kategorie/)).toBeNull();
        expect((screen.getByRole("combobox", { name: "Server" }) as HTMLSelectElement).value).toBe("20002");
        expect(api.getPugOnboarding).toHaveBeenCalledTimes(2);
    });

    it("switches a server to PuG-Server in its dialog and saves the switch", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData());
        render();
        fireEvent.click(await screen.findByRole("button", { name: "Server bearbeiten" }));
        const dialog = await screen.findByRole("dialog");
        const toggle = within(dialog).getByRole("switch", { name: "PuG-Server" });
        expect(toggle).not.toBeChecked();
        fireEvent.click(toggle);
        expect(toggle).toBeChecked();
        fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
        expect(vi.mocked(api.updateSettings).mock.calls[0][0]).toEqual({
            discordServers: { servers: [{ guildId: "10001", label: "", pug: true }] },
        });
    });

    it("switches a PuG server off again and leaves the field out", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ pug: true }));
        render();
        fireEvent.click(await screen.findByRole("button", { name: "Server bearbeiten" }));
        const dialog = await screen.findByRole("dialog");
        const toggle = within(dialog).getByRole("switch", { name: "PuG-Server" });
        expect(toggle).toBeChecked();
        fireEvent.click(toggle);
        fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
        expect(vi.mocked(api.updateSettings).mock.calls[0][0]).toEqual({
            discordServers: { servers: [{ guildId: "10001", label: "" }] },
        });
    });
});

describe("Discord-Server: Verknüpfungen", () => {
    it("lists a link with source → target, channel, status and language/versions in words", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ links: [LINK] }));
        render("links");
        expect(await screen.findByText("Eventserver")).toBeInTheDocument();
        expect(screen.getByText("#raids")).toBeInTheDocument();
        expect(screen.getByText("Englisch · nur TBC")).toBeInTheDocument();
        expect(screen.getByText("noch nicht gepostet")).toBeInTheDocument();
        // no talk section on the page any more
        expect(document.querySelector("[data-server='talk']")).toBeNull();
    });

    it("creates a link in the modal and saves only the links", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData());
        render("links");
        fireEvent.click(await screen.findByRole("button", { name: "Verknüpfung anlegen" }));
        const dialog = await screen.findByRole("dialog");
        // the only server is preselected as the source
        expect((dialog.querySelector("#srv-link-from") as HTMLSelectElement).value).toBe("10001");
        const save = within(dialog).getByRole("button", { name: "Anlegen" });
        expect(save).toBeDisabled();
        fireEvent.change(dialog.querySelector("#srv-link-to") as HTMLSelectElement, { target: { value: "20002" } });
        // the target's Discord language is the suggestion
        expect((dialog.querySelector("#srv-link-lang") as HTMLSelectElement).value).toBe("en");
        fireEvent.change(dialog.querySelector("#srv-link-channel") as HTMLSelectElement, { target: { value: "c2" } });
        fireEvent.click(within(dialog).getByRole("button", { name: "TBC" }));
        expect(save).toBeEnabled();
        fireEvent.click(save);
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
        const sent = vi.mocked(api.updateSettings).mock.calls[0][0] as { discordServers: Record<string, unknown> };
        expect(sent.discordServers).toEqual({ links: [LINK] });
        // the old talk fields are gone (#897) and never sent
        expect(sent.discordServers).not.toHaveProperty("talkGuildId");
        expect(sent.discordServers).not.toHaveProperty("talkPingChannelId");
    });

    it("shows each link of the same source with its own status and reposts it by its key (#892)", async () => {
        const second: ServerLink = { from: "10001", to: "10001", channelId: "c1", lang: "", versions: [] };
        const status = (key: string, to: string, channelId: string, extra: Partial<api.TalkOverviewStatus>): api.TalkOverviewStatus => ({
            key, from: "10001", to, guildId: "10001", label: "", configured: true, channelId,
            messageId: "m", messageUrl: "", postedAt: Date.now(), editedAt: 0, checkedAt: 0, error: "", ...extra,
        });
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ links: [LINK, second] }));
        vi.mocked(api.getTalkOverview).mockResolvedValue({
            statuses: [status("10001:20002", "20002", "c2", {}), status("10001:10001", "10001", "c1", { error: "Bot darf nicht schreiben" })],
        });
        vi.mocked(api.repostTalkOverview).mockResolvedValue({
            result: { key: "10001:10001", from: "10001", to: "10001", guildId: "10001", label: "", status: "posted" },
            status: status("10001:10001", "10001", "c1", {}),
        });
        render("links");
        expect(await screen.findByText("Fehler")).toBeInTheDocument();
        expect(screen.getAllByText("Aktuell")).toHaveLength(1);
        const rows = screen.getAllByRole("button", { name: "Neu posten" });
        expect(rows).toHaveLength(2);
        // the second row is the link onto the source itself (#orga-gildenbank)
        const secondRow = screen.getByText("#orga-gildenbank").closest("tr") as HTMLElement;
        fireEvent.click(within(secondRow).getByRole("button", { name: "Neu posten" }));
        await waitFor(() => expect(api.repostTalkOverview).toHaveBeenCalledWith("10001:10001"));
        // only that link's status is replaced; the other keeps its own
        await waitFor(() => expect(screen.getAllByText("Aktuell")).toHaveLength(2));
        expect(screen.queryByText("Fehler")).toBeNull();
    });

    it("removes a link after the confirm", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ links: [LINK] }));
        render("links");
        fireEvent.click(await screen.findByRole("button", { name: "Verknüpfung entfernen" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText("Die Raid-Liste von Pulse wird nicht mehr in #raids auf Eventserver gepostet.")).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole("button", { name: "Verknüpfung entfernen" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
        expect(vi.mocked(api.updateSettings).mock.calls[0][0]).toEqual({ discordServers: { links: [] } });
    });

    it("hints that a source without a raid category gives an empty list", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ raidCategories: 0 }));
        render();
        // "keine" is a normal state in the servers table (tab Server)
        expect(await screen.findByText("keine")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("tab", { name: /^Verknüpfungen/ }));
        fireEvent.click(await screen.findByRole("button", { name: "Verknüpfung anlegen" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByRole("note")).toHaveTextContent("Pulse hat noch keine Raid-Kategorie.");
    });

    it("shows no hint for a source with raid categories", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ raidCategories: 2 }));
        render("links");
        fireEvent.click(await screen.findByRole("button", { name: "Verknüpfung anlegen" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).queryByRole("note")).toBeNull();
    });
});

describe("Discord-Server: Server", () => {
    it("removes a server together with the links it is the source of", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ links: [LINK] }));
        render();
        fireEvent.click(await screen.findByRole("button", { name: "Server entfernen" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(/1 Verknüpfung mit diesem Server als Quelle wird mit entfernt/)).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole("button", { name: "Server entfernen" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
        expect(vi.mocked(api.updateSettings).mock.calls[0][0]).toEqual({ discordServers: { servers: [], links: [] } });
    });

    // #897: there is no locked ping server any more, every server opens the remove dialog
    it("lets every server be removed", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ links: [LINK] }));
        vi.mocked(api.getRoleSync).mockReturnValue(new Promise(() => undefined));
        render();
        const remove = await screen.findByRole("button", { name: "Server entfernen" });
        expect(remove).not.toHaveAttribute("aria-disabled");
        fireEvent.click(remove);
        expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });

    it("words members and raid categories with their noun", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ raidCategories: 1 }));
        render();
        // once in its column, once in the line under the name that narrow screens show instead
        expect(await screen.findAllByText("12 Mitglieder")).toHaveLength(2);
        expect(screen.getAllByText("1 Raid-Kategorie")).toHaveLength(2);
    });

    it("words no raid category with its noun in the line under the name", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ raidCategories: 0 }));
        render();
        await screen.findAllByText("12 Mitglieder");
        expect(document.querySelector(".srv-sub")?.textContent).toContain("0 Raid-Kategorien");
    });
});

describe("Discord-Server: Einladungen (#905)", () => {
    const invite = (extra: Partial<api.PugLinkInvite> = {}): api.PugLinkInvite => ({
        key: "10001:20002", from: "10001", to: "20002", code: "abc123", url: "https://discord.gg/abc123",
        channelId: "c2", createdAt: 1, error: "", deleted: false, joined: 3, signedUp: 1, ...extra,
    });

    it("shows the link's invite code with copy and its numbers in the same compact cell", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ links: [LINK] }));
        vi.mocked(api.getPugInvites).mockResolvedValue({ links: [invite()], servers: [] });
        render("links");
        expect(await screen.findByText("abc123")).toBeInTheDocument();
        const td = screen.getByText("abc123").closest("td") as HTMLElement;
        expect(within(td).getByRole("button", { name: "Einladung kopieren" })).toBeInTheDocument();
        expect(within(td).getByText("3 beigetreten")).toBeInTheDocument();
        expect(within(td).getByText("1 angemeldet")).toBeInTheDocument();
        // six columns, every value cell labelled for the stacked narrow layout
        const table = td.closest("table") as HTMLElement;
        expect(table.querySelectorAll("thead th")).toHaveLength(6);
        expect(td).toHaveAttribute("data-label", "Einladung");
    });

    it("offers a green Erzeugen without counting numbers while there is no invite", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ links: [LINK] }));
        vi.mocked(api.getPugInvites).mockResolvedValue({ links: [invite({ code: "", url: "", joined: 0, signedUp: 0 })], servers: [] });
        render("links");
        const create = await screen.findByRole("button", { name: "Erzeugen" });
        expect(create).toHaveClass("btn-go");
        expect(screen.getByRole("button", { name: /Neu posten/ })).not.toHaveClass("btn-go");
        expect(screen.queryByText("0 beigetreten")).toBeNull();
    });

    it("says when the invite was deleted on Discord and creates a new one without asking", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ links: [LINK] }));
        vi.mocked(api.getPugInvites).mockResolvedValue({ links: [invite({ code: "", url: "", deleted: true })], servers: [] });
        vi.mocked(api.postPugInvite).mockResolvedValue({ links: [invite()], servers: [] });
        render("links");
        expect(await screen.findByText("Einladung gelöscht – neu erzeugen?")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Erzeugen" }));
        await waitFor(() => expect(api.postPugInvite).toHaveBeenCalledWith({ key: "10001:20002" }, false));
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(await screen.findByText("abc123")).toBeInTheDocument();
    });

    it("labels a problem with an existing invite differently from a missing invite", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ links: [LINK] }));
        vi.mocked(api.getPugInvites).mockResolvedValue({ links: [invite({ error: "Bot fehlt das Recht Server verwalten" })], servers: [] });
        render("links");
        expect(await screen.findByText("Einladung prüfen")).toBeInTheDocument();
        expect(screen.queryByText("Keine Einladung")).toBeNull();
        expect(screen.getByText("abc123")).toBeInTheDocument();
    });

    it("says in the remove dialog that the link's invite is deleted on Discord", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ links: [LINK] }));
        vi.mocked(api.getPugInvites).mockResolvedValue({ links: [invite()], servers: [] });
        render("links");
        await screen.findByText("abc123");
        fireEvent.click(screen.getByRole("button", { name: "Verknüpfung entfernen" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(/Ihre Einladung wird auf Discord gelöscht\./)).toBeInTheDocument();
    });

    it("leaves the invite sentence out of the remove dialog when there is none", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ links: [LINK] }));
        vi.mocked(api.getPugInvites).mockResolvedValue({ links: [invite({ code: "", url: "" })], servers: [] });
        render("links");
        fireEvent.click(await screen.findByRole("button", { name: "Verknüpfung entfernen" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).queryByText(/Einladung wird auf Discord/)).toBeNull();
    });

    it("creates a missing invite by the link's key and names a missing right", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ links: [LINK] }));
        vi.mocked(api.getPugInvites).mockResolvedValue({ links: [invite({ code: "", url: "", error: "Bot fehlt das Recht „Einladung erstellen“" })], servers: [] });
        vi.mocked(api.postPugInvite).mockResolvedValue({ links: [invite()], servers: [] });
        render("links");
        expect(await screen.findByText("Keine Einladung")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Erzeugen" }));
        await waitFor(() => expect(api.postPugInvite).toHaveBeenCalledWith({ key: "10001:20002" }, false));
        expect(await screen.findByText("abc123")).toBeInTheDocument();
        expect(screen.queryByText("Keine Einladung")).toBeNull();
    });

    it("asks before regenerating an invite", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ links: [LINK] }));
        vi.mocked(api.getPugInvites).mockResolvedValue({ links: [invite()], servers: [] });
        vi.mocked(api.postPugInvite).mockResolvedValue({ links: [invite({ code: "new999", url: "https://discord.gg/new999" })], servers: [] });
        render("links");
        await screen.findByText("abc123");
        fireEvent.click(screen.getByRole("button", { name: "Neu erzeugen" }));
        const dialog = await screen.findByRole("dialog");
        expect(api.postPugInvite).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole("button", { name: "Neu erzeugen" }));
        await waitFor(() => expect(api.postPugInvite).toHaveBeenCalledWith({ key: "10001:20002" }, true));
        expect(await screen.findByText("new999")).toBeInTheDocument();
    });

    const SERVER_INVITE_SENTENCE = "Die Einladungen des Bots auf diesem Server werden auf Discord gelöscht.";

    it("says in the remove-server dialog that the invite of a link it is the source of is deleted", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ links: [LINK] }));
        vi.mocked(api.getPugInvites).mockResolvedValue({ links: [invite()], servers: [] });
        render("links");
        await screen.findByText("abc123");
        fireEvent.click(screen.getByRole("tab", { name: /^Server/ }));
        fireEvent.click(await screen.findByRole("button", { name: "Server entfernen" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(new RegExp(SERVER_INVITE_SENTENCE))).toBeInTheDocument();
    });

    it("says in the remove-server dialog that the server's general invite is deleted", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData());
        vi.mocked(api.getPugInvites).mockResolvedValue({ links: [], servers: [{
            guildId: "10001", source: false, code: "gen777", url: "https://discord.gg/gen777",
            channelId: "c1", inviteChannelId: "c1", error: "", deleted: false,
        }] });
        render();
        // the general invite shows nowhere on the page, so let the loaded invites settle before opening the dialog
        const remove = await screen.findByRole("button", { name: "Server entfernen" });
        await waitFor(() => expect(api.getPugInvites).toHaveBeenCalled());
        await act(async () => undefined);
        fireEvent.click(remove);
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(new RegExp(SERVER_INVITE_SENTENCE))).toBeInTheDocument();
        expect(within(dialog).queryByText(/Verknüpfung mit diesem Server als Quelle/)).toBeNull();
    });

    it("leaves the invite sentence out of the remove-server dialog without any invite", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData());
        render();
        fireEvent.click(await screen.findByRole("button", { name: "Server entfernen" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).queryByText(/Einladungen des Bots/)).toBeNull();
    });
});

describe("Discord-Server: Kanäle je Server (#924)", () => {
    const channelRow = async () => {
        const table = (await screen.findByText("Gildenbank", { selector: "th, th *" })).closest("table") as HTMLElement;
        return within(table).getByText("Pulse").closest("tr") as HTMLElement;
    };

    it("names the guild bank channel in the server's row", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ guildBankChannelId: "c1", signupNoteChannelId: "c1" }));
        render();
        const tr = await channelRow();
        expect(within(tr).getAllByText("#orga-gildenbank")).toHaveLength(2);
        expect(tr.querySelector(".srv-warn")).toBeNull();
    });

    it("warns in the cell of a server without a signup note channel, the reason in its tooltip", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData());
        render();
        const tr = await channelRow();
        expect(within(tr).getAllByText("nicht gesetzt")).toHaveLength(2);
        // design B: no sentence under the table, the warning sits in the note cell
        const warn = tr.querySelector(".srv-warn") as HTMLElement;
        expect(warn.textContent).toBe("nicht gesetzt");
        expect(warn.getAttribute("data-tip")).toBe("Ohne diesen Kanal postet der Bot Vielleicht und Absage auf Pulse nicht.");
        expect(warn.tabIndex).toBe(0);
        // the bank stays a quiet "nicht gesetzt": without it there is only no button
        expect(tr.querySelectorAll(".srv-warn")).toHaveLength(1);
    });

    it("picks the channel in the server's dialog and saves only that server's channels", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData());
        render();
        const tr = await channelRow();
        fireEvent.click(within(tr).getByRole("button", { name: "Kanäle bearbeiten" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(/Pulse/)).toBeInTheDocument();
        const picker = dialog.querySelector("#srv-bank") as HTMLSelectElement;
        expect(dialog.querySelector("[data-tip-sub='Hier landen die Anfragen aus der Raid-Zentrale; leer = kein Gildenbank-Knopf.']")).not.toBeNull();
        expect(within(picker).getByRole("option", { name: "— keine Gildenbank —" })).toBeInTheDocument();
        // only the server's own channels are offered
        expect(within(picker).queryByRole("option", { name: /raids/ })).toBeNull();
        fireEvent.change(picker, { target: { value: "c1" } });
        fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
        expect(vi.mocked(api.updateSettings).mock.calls[0][0]).toEqual({
            discordServers: { channels: { "10001": { guildBankChannelId: "c1", signupNoteChannelId: "" } } },
        });
    });
});

describe("Discord-Server: Reiter (design B)", () => {
    const Probe = () => <output data-testid="search">{useLocation().search}</output>;
    const renderWithUrl = (route = "/") => renderPage(
        <><DiscordServersSection onConfig={() => undefined} crumb="Verbindungen" /><Probe /></>, { route },
    );
    const tab = (name: RegExp) => screen.getByRole("tab", { name });

    it("opens on the tab Server with servers and their channels, the counts beside the words", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ links: [LINK] }));
        renderWithUrl();
        await screen.findByRole("tablist", { name: "Bereiche der Discord-Server" });
        expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Server1", "Verknüpfungen1", "Rollen", "Erinnerungen"]);
        expect(tab(/^Server/)).toHaveAttribute("aria-selected", "true");
        expect(tab(/^Server/).tabIndex).toBe(0);
        expect(tab(/^Rollen/).tabIndex).toBe(-1);
        // at most two parts: the servers and the channels per server, nothing of the other tabs
        expect(document.querySelectorAll(".srv-secs > .sync-part")).toHaveLength(2);
        expect(document.querySelectorAll(".srv-secs .part-head.is-plain")).toHaveLength(2);
        expect(screen.getByText("1 Server")).toBeInTheDocument();
        expect(screen.queryByText("#raids")).toBeNull();
        expect(api.getRoleSync).not.toHaveBeenCalled();
        expect(api.getReminders).not.toHaveBeenCalled();
        expect(screen.getByTestId("search").textContent).toBe("");
    });

    it("switches tabs by click, writes the tab into the URL and remembers it", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ links: [LINK] }));
        renderWithUrl();
        fireEvent.click(await screen.findByRole("tab", { name: /^Verknüpfungen/ }));
        expect(await screen.findByText("#raids")).toBeInTheDocument();
        expect(screen.getByText("1 Verknüpfung")).toBeInTheDocument();
        expect(screen.getByTestId("search").textContent).toBe("?tab=links");
        expect(window.localStorage.getItem("eh-settings-discordserver-tab")).toContain("links");

        fireEvent.click(tab(/^Rollen/));
        await waitFor(() => expect(api.getRoleSync).toHaveBeenCalled());
        expect(screen.getByTestId("search").textContent).toBe("?tab=roles");
        expect(screen.queryByText("#raids")).toBeNull();

        fireEvent.click(tab(/^Erinnerungen/));
        await waitFor(() => expect(api.getReminders).toHaveBeenCalled());
        expect(screen.getByTestId("search").textContent).toBe("?tab=reminders");

        // back to the default: the URL is the clean one again
        fireEvent.click(tab(/^Server/));
        expect(screen.getByTestId("search").textContent).toBe("");
        expect(window.localStorage.getItem("eh-settings-discordserver-tab")).toContain("servers");
    });

    it("opens the tab of a deep link and keeps it for the next visit", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ links: [LINK] }));
        const first = renderWithUrl("/?tab=links");
        expect(await screen.findByText("#raids")).toBeInTheDocument();
        expect(tab(/^Verknüpfungen/)).toHaveAttribute("aria-selected", "true");
        first.unmount();
        // a later visit without the param opens the remembered tab
        renderWithUrl("/");
        expect(await screen.findByText("#raids")).toBeInTheDocument();
        expect(tab(/^Verknüpfungen/)).toHaveAttribute("aria-selected", "true");
    });

    it("ignores an unknown tab in the URL", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData());
        renderWithUrl("/?tab=nope");
        expect(await screen.findByRole("tab", { name: /^Server/ })).toHaveAttribute("aria-selected", "true");
    });

    it("moves between the tabs with the arrow keys, Home and End", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData());
        renderWithUrl();
        fireEvent.keyDown(await screen.findByRole("tab", { name: /^Server/ }), { key: "ArrowRight" });
        expect(tab(/^Verknüpfungen/)).toHaveAttribute("aria-selected", "true");
        expect(document.activeElement).toBe(tab(/^Verknüpfungen/));
        fireEvent.keyDown(tab(/^Verknüpfungen/), { key: "End" });
        expect(tab(/^Erinnerungen/)).toHaveAttribute("aria-selected", "true");
        fireEvent.keyDown(tab(/^Erinnerungen/), { key: "ArrowRight" });
        expect(tab(/^Server/)).toHaveAttribute("aria-selected", "true");
        fireEvent.keyDown(tab(/^Server/), { key: "ArrowLeft" });
        expect(tab(/^Erinnerungen/)).toHaveAttribute("aria-selected", "true");
        fireEvent.keyDown(tab(/^Erinnerungen/), { key: "Home" });
        expect(tab(/^Server/)).toHaveAttribute("aria-selected", "true");
        // other keys change nothing
        fireEvent.keyDown(tab(/^Server/), { key: "a" });
        expect(tab(/^Server/)).toHaveAttribute("aria-selected", "true");
    });
});

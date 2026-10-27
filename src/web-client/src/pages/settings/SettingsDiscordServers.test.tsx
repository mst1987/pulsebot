// Einstellungen → Discord-Server (#891): the links table with create/remove,
// the hint for a source without a raid category, and the guild bank channel.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { AdminConfig, DiscordServersData, ServerLink, ServerRow } from "../../api";
import { renderPage } from "../../test/render";
import DiscordServersSection from "./SettingsDiscordServers";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getDiscordServers: vi.fn(),
    getPugInvites: vi.fn(),
    postPugInvite: vi.fn(),
    getTalkOverview: vi.fn(),
    repostTalkOverview: vi.fn(),
    getRoleSync: vi.fn(),
    getReminders: vi.fn(),
    updateSettings: vi.fn(),
}));

function row(id: string, name: string, raidCategories: number): ServerRow {
    return {
        role: "event", id, name, connected: true, memberCount: 12, iconUrl: "",
        permissions: null, missing: [], label: "", raidCategories, lang: "",
    } as ServerRow;
}

function serversData({ links = [], raidCategories = 2, guildBankChannelId = "" }: {
    links?: ServerLink[]; raidCategories?: number; guildBankChannelId?: string;
} = {}): DiscordServersData {
    return {
        discordServers: {
            servers: [{ guildId: "10001", label: "" }],
            links,
            signupNoteChannelId: "",
            guildBankChannelId,
        },
        servers: [row("10001", "Pulse", raidCategories)],
        guilds: [
            { id: "10001", name: "Pulse", lang: "de", channels: [{ id: "c1", name: "orga-gildenbank", category: "Orga" }] },
            { id: "20002", name: "Eventserver", lang: "en", channels: [{ id: "c2", name: "raids", category: "Events" }] },
        ],
        versions: [{ id: "tbc", label: "TBC Anniversary", short: "TBC" }, { id: "forever", label: "WoW Forever", short: "Forever" }],
    };
}

const LINK: ServerLink = { from: "10001", to: "20002", channelId: "c2", lang: "en", versions: ["tbc"] };

const render = () => renderPage(<DiscordServersSection onConfig={() => undefined} icon="inv_letter_15" crumb="Verbindungen" />);

beforeEach(() => {
    vi.mocked(api.getTalkOverview).mockResolvedValue({ statuses: [] });
    // #896: the role sync part mounts with a single server as well
    vi.mocked(api.getRoleSync).mockResolvedValue({ roleSync: [], servers: [], overlaps: [], drift: [], driftTotal: 0, driftError: null, lastRun: null });
    vi.mocked(api.getReminders).mockResolvedValue({ categoryReminders: {}, categories: [], lastRun: null });
    vi.mocked(api.updateSettings).mockReset();
    vi.mocked(api.updateSettings).mockResolvedValue({ config: {} as AdminConfig });
    vi.mocked(api.getPugInvites).mockResolvedValue({ links: [], servers: [] });
    vi.mocked(api.postPugInvite).mockReset();
});

describe("Discord-Server: Verknüpfungen", () => {
    it("lists a link with source → target, channel, status and language/versions in words", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ links: [LINK] }));
        render();
        expect(await screen.findByText("Eventserver")).toBeInTheDocument();
        expect(screen.getByText("#raids")).toBeInTheDocument();
        expect(screen.getByText("Englisch · nur TBC")).toBeInTheDocument();
        expect(screen.getByText("noch nicht gepostet")).toBeInTheDocument();
        // no talk section on the page any more
        expect(document.querySelector("[data-server='talk']")).toBeNull();
    });

    it("creates a link in the modal and saves only the links", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData());
        render();
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
        render();
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
        render();
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
        // "keine" is a normal state in the servers table
        expect(await screen.findByText("keine")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Verknüpfung anlegen" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByRole("note")).toHaveTextContent("Pulse hat noch keine Raid-Kategorie.");
    });

    it("shows no hint for a source with raid categories", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ raidCategories: 2 }));
        render();
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
        render();
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
        render();
        const create = await screen.findByRole("button", { name: "Erzeugen" });
        expect(create).toHaveClass("btn-go");
        expect(screen.getByRole("button", { name: /Neu posten/ })).not.toHaveClass("btn-go");
        expect(screen.queryByText("0 beigetreten")).toBeNull();
    });

    it("says when the invite was deleted on Discord and creates a new one without asking", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ links: [LINK] }));
        vi.mocked(api.getPugInvites).mockResolvedValue({ links: [invite({ code: "", url: "", deleted: true })], servers: [] });
        vi.mocked(api.postPugInvite).mockResolvedValue({ links: [invite()], servers: [] });
        render();
        expect(await screen.findByText("Einladung gelöscht – neu erzeugen?")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Erzeugen" }));
        await waitFor(() => expect(api.postPugInvite).toHaveBeenCalledWith({ key: "10001:20002" }, false));
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(await screen.findByText("abc123")).toBeInTheDocument();
    });

    it("labels a problem with an existing invite differently from a missing invite", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ links: [LINK] }));
        vi.mocked(api.getPugInvites).mockResolvedValue({ links: [invite({ error: "Bot fehlt das Recht Server verwalten" })], servers: [] });
        render();
        expect(await screen.findByText("Einladung prüfen")).toBeInTheDocument();
        expect(screen.queryByText("Keine Einladung")).toBeNull();
        expect(screen.getByText("abc123")).toBeInTheDocument();
    });

    it("says in the remove dialog that the link's invite is deleted on Discord", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ links: [LINK] }));
        vi.mocked(api.getPugInvites).mockResolvedValue({ links: [invite()], servers: [] });
        render();
        await screen.findByText("abc123");
        fireEvent.click(screen.getByRole("button", { name: "Verknüpfung entfernen" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(/Ihre Einladung wird auf Discord gelöscht\./)).toBeInTheDocument();
    });

    it("leaves the invite sentence out of the remove dialog when there is none", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ links: [LINK] }));
        vi.mocked(api.getPugInvites).mockResolvedValue({ links: [invite({ code: "", url: "" })], servers: [] });
        render();
        fireEvent.click(await screen.findByRole("button", { name: "Verknüpfung entfernen" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).queryByText(/Einladung wird auf Discord/)).toBeNull();
    });

    it("creates a missing invite by the link's key and names a missing right", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ links: [LINK] }));
        vi.mocked(api.getPugInvites).mockResolvedValue({ links: [invite({ code: "", url: "", error: "Bot fehlt das Recht „Einladung erstellen“" })], servers: [] });
        vi.mocked(api.postPugInvite).mockResolvedValue({ links: [invite()], servers: [] });
        render();
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
        render();
        await screen.findByText("abc123");
        fireEvent.click(screen.getByRole("button", { name: "Neu erzeugen" }));
        const dialog = await screen.findByRole("dialog");
        expect(api.postPugInvite).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole("button", { name: "Neu erzeugen" }));
        await waitFor(() => expect(api.postPugInvite).toHaveBeenCalledWith({ key: "10001:20002" }, true));
        expect(await screen.findByText("new999")).toBeInTheDocument();
    });
});

describe("Discord-Server: Gildenbank-Kanal", () => {
    it("names the guild bank channel", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ guildBankChannelId: "c1" }));
        render();
        const item = (await screen.findByText("Gildenbank")).closest("li") as HTMLElement;
        expect(within(item).getByText("#orga-gildenbank")).toBeInTheDocument();
    });

    it("picks the channel in the dialog and saves only the two channels", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData());
        render();
        const item = (await screen.findByText("Gildenbank")).closest("li") as HTMLElement;
        expect(within(item).getByText("—")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Kanäle bearbeiten" }));
        const dialog = await screen.findByRole("dialog");
        const picker = dialog.querySelector("#srv-bank") as HTMLSelectElement;
        expect(dialog.querySelector("[data-tip-sub='Hier landen die Anfragen aus der Raid-Zentrale; leer = kein Gildenbank-Knopf.']")).not.toBeNull();
        expect(within(picker).getByRole("option", { name: "— keine Gildenbank —" })).toBeInTheDocument();
        fireEvent.change(picker, { target: { value: "c1" } });
        fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
        expect(vi.mocked(api.updateSettings).mock.calls[0][0]).toEqual({ discordServers: { guildBankChannelId: "c1", signupNoteChannelId: "" } });
    });
});

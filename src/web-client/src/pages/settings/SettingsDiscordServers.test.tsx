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
        talk: null,
    };
}

const LINK: ServerLink = { from: "10001", to: "20002", channelId: "c2", lang: "en", versions: ["tbc"] };

const render = () => renderPage(<DiscordServersSection onConfig={() => undefined} icon="inv_letter_15" crumb="Verbindungen" />);

beforeEach(() => {
    vi.mocked(api.getTalkOverview).mockResolvedValue({ statuses: [] });
    vi.mocked(api.getReminders).mockResolvedValue({ categoryReminders: {}, categories: [], pingTargets: { talk: false, talkGuildName: "", talkChannelName: "" }, lastRun: null });
    vi.mocked(api.updateSettings).mockReset();
    vi.mocked(api.updateSettings).mockResolvedValue({ config: {} as AdminConfig });
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
        // the old talk fields are never sent, so they stay stored until #897
        expect(sent.discordServers).not.toHaveProperty("talkGuildId");
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

    it("words members and raid categories with their noun", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData({ raidCategories: 1 }));
        render();
        expect(await screen.findByText("12 Mitglieder")).toBeInTheDocument();
        expect(screen.getByText("1 Raid-Kategorie")).toBeInTheDocument();
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

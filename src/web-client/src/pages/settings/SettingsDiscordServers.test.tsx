// Einstellungen → Discord-Server: the guild bank channel — named on the first
// event card, picked in the edit dialog and saved with the servers block.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { AdminConfig, DiscordServersData } from "../../api";
import { renderPage } from "../../test/render";
import DiscordServersSection from "./SettingsDiscordServers";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getDiscordServers: vi.fn(),
    getTalkOverview: vi.fn(),
    getRoleSync: vi.fn(),
    getReminders: vi.fn(),
    updateSettings: vi.fn(),
}));

function serversData(guildBankChannelId: string): DiscordServersData {
    return {
        discordServers: {
            eventGuilds: [{ guildId: "100", label: "", overviewGuildId: "", overviewChannelId: "" }],
            talkGuildId: "", talkPingChannelId: "", signupNoteChannelId: "", guildBankChannelId,
        },
        events: [{
            role: "event", id: "100", name: "Pulse", connected: true, memberCount: 12, iconUrl: "",
            permissions: null, missing: [], label: "", overviewGuildId: "", overviewChannelId: "", overviewGuildName: "",
        }],
        talk: null,
        overlap: null,
        guilds: [{ id: "100", name: "Pulse", channels: [{ id: "c1", name: "orga-gildenbank", category: "Orga" }] }],
    } as unknown as DiscordServersData;
}

beforeEach(() => {
    vi.mocked(api.getTalkOverview).mockResolvedValue({ statuses: [] });
    vi.mocked(api.getReminders).mockResolvedValue({ categoryReminders: {}, categories: [], pingTargets: { talk: false, talkGuildName: "", talkChannelName: "" }, lastRun: null });
    vi.mocked(api.updateSettings).mockResolvedValue({ config: {} as AdminConfig });
});

describe("Discord-Server: Gildenbank-Kanal", () => {
    it("names the guild bank channel on the event card", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData("c1"));
        renderPage(<DiscordServersSection onConfig={() => undefined} icon="inv_letter_15" crumb="Verbindungen" />);
        const row = (await screen.findByText("Gildenbank")).closest("div") as HTMLElement;
        expect(within(row).getByText("#orga-gildenbank")).toBeInTheDocument();
    });

    it("picks the channel in the dialog and saves it with the servers block", async () => {
        vi.mocked(api.getDiscordServers).mockResolvedValue(serversData(""));
        renderPage(<DiscordServersSection onConfig={() => undefined} icon="inv_letter_15" crumb="Verbindungen" />);
        const row = (await screen.findByText("Gildenbank")).closest("div") as HTMLElement;
        expect(within(row).getByText("—")).toBeInTheDocument();
        fireEvent.click(screen.getAllByRole("button", { name: /Bearbeiten/ })[0]);
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText("Kanal für Gildenbank-Anfragen")).toBeInTheDocument();
        const picker = dialog.querySelector("#srv-bank") as HTMLSelectElement;
        // the hint sits in the label's tooltip, like every field of this dialog
        expect(dialog.querySelector("[data-tip-sub='Hier landen die Anfragen aus der Raid-Zentrale; leer = kein Gildenbank-Knopf.']")).not.toBeNull();
        expect(within(picker).getByRole("option", { name: "— keine Gildenbank —" })).toBeInTheDocument();
        fireEvent.change(picker, { target: { value: "c1" } });
        fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
        expect(vi.mocked(api.updateSettings).mock.calls[0][0]).toMatchObject({ discordServers: { guildBankChannelId: "c1", signupNoteChannelId: "" } });
    });
});

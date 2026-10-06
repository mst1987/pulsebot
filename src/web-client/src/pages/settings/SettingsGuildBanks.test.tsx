// Einstellungen → Verbindungen, "Gildenbanken" (#632): the banks the sync tool
// uploaded, waiting ones first, with a server select and delete.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { GuildBankSettings } from "../../api";
import { renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import GuildBanksCard from "./SettingsGuildBanks";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getGuildBankSettings: vi.fn(),
    assignGuildBank: vi.fn(),
    deleteGuildBank: vi.fn(),
}));

function settings(): GuildBankSettings {
    const row = { gameVersion: "tbc", realm: "Spineshatter", scannedAt: Date.UTC(2026, 9, 6, 16, 42), scannedBy: "Gemli", counts: { items: 12 } };
    return {
        banks: [
            { ...row, key: "tbc:spineshatter:beta", guild: "Beta", guildId: "", pending: true, serverName: "" },
            { ...row, key: "tbc:spineshatter:alpha", guild: "Alpha", guildId: "g1", pending: false, serverName: "PvE" },
        ],
        servers: [{ guildId: "g1", name: "Event-Server", label: "PvE" }, { guildId: "g2", name: "PvP", label: "" }],
        pending: 1,
    };
}

beforeEach(() => {
    vi.mocked(api.getGuildBankSettings).mockResolvedValue(settings());
});
afterEach(() => switchLang("de"));

describe("GuildBanksCard", () => {
    it("lists the banks, the waiting one marked, each with its server", async () => {
        renderPage(<GuildBanksCard />);
        expect(await screen.findByText("Beta · Spineshatter")).toBeInTheDocument();
        expect(screen.getByText("1 wartet")).toBeInTheDocument();
        expect(screen.getByText("Wartet auf Zuordnung")).toBeInTheDocument();
        expect(screen.getByLabelText("Server für Beta · Spineshatter")).toHaveValue("");
        expect(screen.getByLabelText("Server für Alpha · Spineshatter")).toHaveValue("g1");
        expect(within(screen.getByLabelText("Server für Beta · Spineshatter")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Keinem Server", "PvE", "PvP"]);
    });

    it("assigns a bank and reads the list again", async () => {
        const user = userEvent.setup();
        vi.mocked(api.assignGuildBank).mockResolvedValue({ bank: settings().banks[0] });
        renderPage(<GuildBanksCard />);
        await user.selectOptions(await screen.findByLabelText("Server für Beta · Spineshatter"), "g2");
        expect(api.assignGuildBank).toHaveBeenCalledWith("tbc:spineshatter:beta", "g2");
        await waitFor(() => expect(api.getGuildBankSettings).toHaveBeenCalledTimes(2));
        expect(await screen.findByText("Beta · Spineshatter gehört jetzt zu PvP.")).toBeInTheDocument();
    });

    it("deletes a bank after asking", async () => {
        const user = userEvent.setup();
        vi.mocked(api.deleteGuildBank).mockResolvedValue({ key: "tbc:spineshatter:alpha" });
        renderPage(<GuildBanksCard />);
        await screen.findByText("Alpha · Spineshatter");
        await user.click(screen.getAllByRole("button", { name: "Gildenbank entfernen" })[1]);
        expect(await screen.findByText("Alpha · Spineshatter entfernen?")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Löschen" }));
        expect(api.deleteGuildBank).toHaveBeenCalledWith("tbc:spineshatter:alpha");
    });

    it("says when no scan has arrived, in English too", async () => {
        vi.mocked(api.getGuildBankSettings).mockResolvedValue({ banks: [], servers: [], pending: 0 });
        switchLang("en");
        renderPage(<GuildBanksCard />);
        expect(await screen.findByText("No scan has arrived yet.")).toBeInTheDocument();
        expect(screen.getByText("Guild banks")).toBeInTheDocument();
    });
});

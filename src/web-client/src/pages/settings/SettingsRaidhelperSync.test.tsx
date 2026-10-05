// Einstellungen → Verbindungen, "Raid-Helper-Abgleich" (#608): when the one job
// last fetched Raid-Helper's event list, how much of the daily limit is used,
// and "Jetzt aktualisieren".
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { RaidhelperSync } from "../../api";
import { renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import RaidhelperSyncCard from "./SettingsRaidhelperSync";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getRaidhelperSync: vi.fn(),
    refreshRaidhelperSync: vi.fn(),
}));

function sync(over: Partial<RaidhelperSync> = {}): RaidhelperSync {
    return {
        syncedAt: Date.now() - 3 * 60000,
        events: 12,
        error: "",
        errorAt: 0,
        intervalMs: 300000,
        disabled: false,
        budget: { used: 123, limit: 1000, caps: { background: 450, read: 750, write: 850 }, blockedUntil: 0 },
        ...over,
    };
}

afterEach(() => switchLang("de"));

describe("RaidhelperSyncCard", () => {
    it("shows the last sync, its events and the day's requests", async () => {
        vi.mocked(api.getRaidhelperSync).mockResolvedValue(sync());
        renderPage(<RaidhelperSyncCard />);
        expect(await screen.findByText("vor 3 Minuten")).toBeInTheDocument();
        expect(screen.getByText(/· 12 Events/)).toBeInTheDocument();
        expect(screen.getByText("123 von 1000")).toBeInTheDocument();
    });

    it("names the last error and a pause Raid-Helper asked for", async () => {
        const now = Date.now();
        vi.mocked(api.getRaidhelperSync).mockResolvedValue(sync({
            error: "Raid-Helper: Rate limit encountered", errorAt: now,
            budget: { used: 1000, limit: 1000, caps: { background: 450, read: 750, write: 850 }, blockedUntil: now + 3600000 },
        }));
        renderPage(<RaidhelperSyncCard />);
        expect(await screen.findByText("Raid-Helper: Rate limit encountered")).toBeInTheDocument();
        expect(screen.getByText(/keine Anfragen/)).toBeInTheDocument();
    });

    it("refreshes on a click and shows the new state", async () => {
        vi.mocked(api.getRaidhelperSync).mockResolvedValue(sync({ syncedAt: 0, events: 0 }));
        vi.mocked(api.refreshRaidhelperSync).mockResolvedValue(sync({ syncedAt: Date.now(), events: 4, ok: true, throttled: false }));
        renderPage(<RaidhelperSyncCard />);
        expect(await screen.findByText("noch nie abgeglichen")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: /Jetzt aktualisieren/ }));
        expect(api.refreshRaidhelperSync).toHaveBeenCalledTimes(1);
        expect(await screen.findByText("vor 0 Minuten")).toBeInTheDocument();
        expect(screen.getByText(/· 4 Events/)).toBeInTheDocument();
    });

    it("offers no refresh while Raid-Helper is switched off", async () => {
        vi.mocked(api.getRaidhelperSync).mockResolvedValue(sync({ disabled: true }));
        renderPage(<RaidhelperSyncCard />);
        expect(await screen.findByText("abgeschaltet")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Jetzt aktualisieren/ })).toBeDisabled();
    });

    it("speaks English when the reader switches", async () => {
        switchLang("en");
        vi.mocked(api.getRaidhelperSync).mockResolvedValue(sync());
        renderPage(<RaidhelperSyncCard />);
        expect(await screen.findByText("3 minutes ago")).toBeInTheDocument();
        expect(screen.getByText("123 of 1000")).toBeInTheDocument();
    });
});

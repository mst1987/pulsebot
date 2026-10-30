// Einstellungen → <Server> → Log-Auswertung → Warcraft-Logs-Gilde (#922): the
// rows of the active server, saved with the server the page loaded, "Jetzt
// abrufen" only for a stored row, a switched tab gets the server_switched toast.
import { useState } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../../api";
import type { WclGuild } from "../../../../api";
import { t } from "../../../../i18n";
import { renderPage } from "../../../../test/render";
import WclGuildsSection from "../SettingsWclGuilds";

vi.mock("../../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../../api")>()),
    updateSettings: vi.fn(),
    fetchWclGuild: vi.fn(),
}));

const VERSIONS = [{ id: "tbc", label: "TBC Anniversary" }, { id: "classic", label: "Classic Era" }];
const SAVED: WclGuild = {
    versionId: "tbc", guildName: "Pulse", realm: "Thunderstrike", region: "EU", interval: 60,
    lastRunAt: Date.now() - 5 * 60000, lastSuccessAt: Date.now() - 5 * 60000, lastResult: { found: 2, error: "", at: Date.now() - 5 * 60000 },
};
const KEY = "tbc|pulse|thunderstrike|EU";

function show(value: WclGuild[] = [SAVED]) {
    const onSaved = vi.fn();
    renderPage(<WclGuildsSection value={value} activeGuildId="g1" versions={VERSIONS} onSaved={onSaved} />);
    return { onSaved };
}

const fetchButton = () => screen.getByRole("button", { name: t("settings.wclGuilds.fetch") });
const saveButton = () => screen.getByRole("button", { name: t("settings.wclGuilds.save") });

beforeEach(() => {
    vi.mocked(api.updateSettings).mockReset();
    vi.mocked(api.fetchWclGuild).mockReset();
});

describe("WclGuildsSection (#922)", () => {
    it("shows the saved rows with their last fetch, and an empty hint without one", () => {
        show();
        expect(screen.getByRole("textbox", { name: t("settings.wclGuilds.guildFor", { n: 1 }) })).toHaveValue("Pulse");
        expect(screen.getByRole("combobox", { name: t("settings.wclGuilds.versionFor", { n: 1 }) })).toHaveValue("tbc");
        expect(document.querySelector(`[data-last="${KEY}"]`)).toHaveTextContent(t("settings.wclGuilds.found", { count: 2 }));
        expect(saveButton()).toBeDisabled();
    });

    it("an empty list shows the hint", () => {
        show([]);
        expect(screen.getByText(t("settings.wclGuilds.empty"))).toBeInTheDocument();
    });

    it("offers Aus and the intervals, an error of the last fetch is shown as such", () => {
        show([{ ...SAVED, lastResult: { found: 0, error: "Warcraft Logs nicht erreichbar.", at: Date.now() } }]);
        const interval = screen.getByRole("combobox", { name: t("settings.wclGuilds.intervalFor", { n: 1 }) });
        const labels = Array.from((interval as HTMLSelectElement).options).map((o) => o.textContent);
        expect(labels[0]).toBe(t("settings.wclGuilds.intervalOff"));
        expect(labels).toHaveLength(7);
        const last = document.querySelector(`[data-last="${KEY}"]`);
        expect(last).toHaveTextContent("Warcraft Logs nicht erreichbar.");
        expect(last).toHaveClass("is-bad");
    });

    it("saves only the list, with the server the page loaded", async () => {
        const user = userEvent.setup();
        vi.mocked(api.updateSettings).mockResolvedValue({ wclGuilds: [{ ...SAVED, interval: 0 }] } as never);
        const { onSaved } = show();
        await user.selectOptions(screen.getByRole("combobox", { name: t("settings.wclGuilds.intervalFor", { n: 1 }) }), "0");
        await user.click(saveButton());
        expect(api.updateSettings).toHaveBeenCalledWith({
            wclGuilds: [{ versionId: "tbc", guildName: "Pulse", realm: "Thunderstrike", region: "EU", interval: 0 }],
            serverSettingsGuildId: "g1",
        });
        expect(onSaved).toHaveBeenCalledWith([{ ...SAVED, interval: 0 }]);
        expect(await screen.findByText(t("settings.wclGuilds.saved"))).toBeInTheDocument();
    });

    it("a typed, unsaved row survives a re-render of the page with a fresh empty list", async () => {
        const user = userEvent.setup();
        // like SettingsPage before the fix: a new [] on every render, and another field changing
        function Parent() {
            const [other, setOther] = useState(0);
            return (
                <>
                    <button type="button" onClick={() => setOther(other + 1)}>other {other}</button>
                    <WclGuildsSection value={[]} activeGuildId="g1" versions={VERSIONS} onSaved={() => {}} />
                </>
            );
        }
        renderPage(<Parent />);
        await user.click(screen.getByRole("button", { name: t("settings.wclGuilds.add") }));
        await user.type(screen.getByRole("textbox", { name: t("settings.wclGuilds.guildFor", { n: 1 }) }), "Pulse");
        await user.click(screen.getByRole("button", { name: "other 0" }));
        expect(screen.getByRole("button", { name: "other 1" })).toBeInTheDocument();
        expect(screen.getByRole("textbox", { name: t("settings.wclGuilds.guildFor", { n: 1 }) })).toHaveValue("Pulse");
    });

    it("a new row needs a guild and a realm before it saves", async () => {
        const user = userEvent.setup();
        show([]);
        await user.click(screen.getByRole("button", { name: t("settings.wclGuilds.add") }));
        await user.click(saveButton());
        expect(api.updateSettings).not.toHaveBeenCalled();
        expect(await screen.findByText(t("settings.wclGuilds.incomplete"))).toBeInTheDocument();
    });

    it("fetches a stored row now and reports the count", async () => {
        const user = userEvent.setup();
        const after = { ...SAVED, lastResult: { found: 3, error: "", at: Date.now() } };
        vi.mocked(api.fetchWclGuild).mockResolvedValue({ key: KEY, result: { found: 3, error: "", at: Date.now() }, wclGuilds: [after] });
        const { onSaved } = show();
        await user.click(fetchButton());
        expect(api.fetchWclGuild).toHaveBeenCalledWith(KEY, "g1");
        expect(onSaved).toHaveBeenCalledWith([after]);
        expect(await screen.findByText(t("settings.wclGuilds.fetched", { count: 3 }))).toBeInTheDocument();
    });

    it("a row changed but not saved cannot be fetched yet", async () => {
        const user = userEvent.setup();
        show();
        expect(fetchButton()).toBeEnabled();
        await user.selectOptions(screen.getByRole("combobox", { name: t("settings.wclGuilds.intervalFor", { n: 1 }) }), "15");
        expect(fetchButton()).toBeDisabled();
        await user.clear(screen.getByRole("textbox", { name: t("settings.wclGuilds.guildFor", { n: 1 }) }));
        expect(fetchButton()).toBeDisabled();
    });

    it("a tab of another server gets the server-switched toast", async () => {
        const user = userEvent.setup();
        vi.mocked(api.fetchWclGuild).mockRejectedValue({ code: "server_switched", message: "x" });
        show();
        await user.click(fetchButton());
        expect(await screen.findByText(t("settings.serverSwitched"))).toBeInTheDocument();
    });
});

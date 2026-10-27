// Einstellungen → Server → Raid-Helper (#927): the switch, the optional
// Raid-Helper server id and the key per Discord server. The key is never shown,
// only whether there is one and its last 4 characters; it is replaced or cleared.
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { RaidhelperServer, RaidhelperSync } from "../../api";
import { t } from "../../i18n";
import { renderPage } from "../../test/render";
import RaidhelperServerSection from "./SettingsRaidhelperServer";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    updateSettings: vi.fn(),
    getRaidhelperSync: vi.fn(),
    refreshRaidhelperSync: vi.fn(),
    getRaidhelperRetirement: vi.fn(),
}));

const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const GUILD = "1139509316387344395";
const server = (over: Partial<RaidhelperServer> = {}): RaidhelperServer => ({
    enabled: false, serverId: "", hasKey: false, keyLast4: "", envKey: false, active: false, at: 0, byName: "", ...over,
});
const sync: RaidhelperSync = {
    syncedAt: 0, events: 0, error: "", errorAt: 0, intervalMs: 300000, disabled: false,
    budget: { used: 0, limit: 1000, caps: { background: 450, read: 750, write: 850 }, blockedUntil: 0 },
};

beforeEach(() => {
    vi.mocked(api.updateSettings).mockReset();
    vi.mocked(api.getRaidhelperSync).mockResolvedValue(sync);
    vi.mocked(api.getRaidhelperRetirement).mockReturnValue(new Promise(() => undefined) as never);
});

describe("RaidhelperServerSection", () => {
    it("starts off without a key and shows neither sync nor checklist", () => {
        renderPage(<RaidhelperServerSection value={null} activeGuildId={GUILD} onSaved={vi.fn()} />);
        expect(screen.getByRole("switch", { name: t("settings.raidhelperServer.enabled") })).not.toBeChecked();
        expect(screen.getByText(t("settings.raidhelperServer.keyNone"))).toBeInTheDocument();
        expect(field("rh-server-id")).toHaveAttribute("placeholder", GUILD);
        expect(api.getRaidhelperSync).not.toHaveBeenCalled();
    });

    it("shows a stored key only by its last 4 characters, never in the field", () => {
        renderPage(<RaidhelperServerSection value={server({ enabled: true, hasKey: true, keyLast4: "9876", active: true })} activeGuildId={GUILD} onSaved={vi.fn()} />);
        expect(screen.getByText(t("settings.raidhelperServer.keyStored", { last4: "9876" }))).toBeInTheDocument();
        expect(field("rh-server-key")).toHaveValue("");
        expect(field("rh-server-key")).toHaveAttribute("type", "password");
        expect(api.getRaidhelperSync).toHaveBeenCalled();
    });

    it("names the .env key without offering to delete it", () => {
        renderPage(<RaidhelperServerSection value={server({ enabled: true, hasKey: true, envKey: true, active: true })} activeGuildId={GUILD} onSaved={vi.fn()} />);
        expect(screen.getByText(t("settings.raidhelperServer.keyEnv"))).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: t("common.delete") })).toBeNull();
    });

    it("switches on with a new key and server id and saves only this block", async () => {
        const saved = server({ enabled: true, serverId: "123456789012345678", hasKey: true, keyLast4: "ABCD", active: true });
        vi.mocked(api.updateSettings).mockResolvedValue({ raidhelper: saved } as never);
        const onSaved = vi.fn();
        const user = userEvent.setup();
        renderPage(<RaidhelperServerSection value={null} activeGuildId={GUILD} onSaved={onSaved} />);
        await user.click(screen.getByRole("switch", { name: t("settings.raidhelperServer.enabled") }));
        expect(screen.getByText(t("settings.raidhelperServer.noKeyHint"))).toBeInTheDocument();
        await user.type(field("rh-server-id"), "123456789012345678");
        await user.type(field("rh-server-key"), " fake-key-ABCD ");
        await user.click(screen.getByRole("button", { name: t("common.save") }));
        expect(api.updateSettings).toHaveBeenCalledWith({ raidhelper: { enabled: true, serverId: "123456789012345678", apiKey: "fake-key-ABCD" } });
        expect(onSaved).toHaveBeenCalledWith(saved);
        expect(field("rh-server-key")).toHaveValue("");
    });

    it("keeps the key when none is typed and clears it on delete", async () => {
        const value = server({ enabled: true, hasKey: true, keyLast4: "9876", active: true });
        vi.mocked(api.updateSettings).mockResolvedValue({ raidhelper: value } as never);
        const user = userEvent.setup();
        renderPage(<RaidhelperServerSection value={value} activeGuildId={GUILD} onSaved={vi.fn()} />);
        expect(screen.getByRole("button", { name: t("common.save") })).toBeDisabled();

        await user.click(screen.getByRole("button", { name: t("common.delete") }));
        await user.click(screen.getByRole("button", { name: t("common.save") }));
        expect(api.updateSettings).toHaveBeenLastCalledWith({ raidhelper: { apiKey: "" } });
    });

    // epic #926: the active server is per session, so a stale tab must not send
    // fields it did not change (they would overwrite another server's values)
    it("sends only the fields changed in this tab", async () => {
        const value = server({ enabled: true, serverId: "123456789012345678", hasKey: true, keyLast4: "9876", active: true });
        vi.mocked(api.updateSettings).mockResolvedValue({ raidhelper: { ...value, enabled: false } } as never);
        const user = userEvent.setup();
        renderPage(<RaidhelperServerSection value={value} activeGuildId={GUILD} onSaved={vi.fn()} />);
        await user.click(screen.getByRole("switch", { name: t("settings.raidhelperServer.enabled") }));
        await user.click(screen.getByRole("button", { name: t("common.save") }));
        expect(api.updateSettings).toHaveBeenCalledWith({ raidhelper: { enabled: false } });
    });

    it("refuses a server id with letters before asking the server", async () => {
        const user = userEvent.setup();
        renderPage(<RaidhelperServerSection value={null} activeGuildId={GUILD} onSaved={vi.fn()} />);
        await user.type(field("rh-server-id"), "abc");
        expect(screen.getByText(t("settings.raidhelperServer.serverIdInvalid"))).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: t("common.save") }));
        expect(screen.getByRole("button", { name: t("common.save") })).toBeEnabled();
        expect(api.updateSettings).not.toHaveBeenCalled();
    });
});

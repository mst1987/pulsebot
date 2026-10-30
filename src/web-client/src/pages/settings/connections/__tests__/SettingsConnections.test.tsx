// The Loot-Sync token table works per Discord server (#994): a token shows the
// server it belongs to, a token minted before the split gets a picker instead,
// and picking a server binds it and reloads the list.
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../../api";
import type { AdminConfig, IngestToken, IngestTokenServer, SettingsData } from "../../../../api";
import { renderPage } from "../../../../test/render";
import { switchLang } from "../../../../test/i18n";
import ConnectionsSection from "../SettingsConnections";

vi.mock("../../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../../api")>()),
    assignIngestToken: vi.fn(),
    createIngestToken: vi.fn(),
    deleteIngestToken: vi.fn(),
}));

function settings(): SettingsData {
    return {
        config: {
            adminRoleIds: ["r1"], rolePermissions: {}, guildId: "gA",
            blizzard: { clientId: "", region: "eu", realmSlug: "thunderstrike", namespace: "" },
        } as unknown as AdminConfig,
        canManageAccess: true, areas: [], raidsheets: [], roles: [], categories: [], channels: [],
        bot: { online: true, readySince: 0, guildName: "Pulse" },
        servers: { events: [] },
        activeGuildId: "gA",
    } as unknown as SettingsData;
}

const token = (over: Partial<IngestToken>): IngestToken => ({
    id: "t1", name: "Raidlead-PC", hint: "ab12", createdAt: 1, createdBy: "Admin",
    lastUsedAt: 0, uses: 0, guildId: "", ...over,
});

const SERVERS: IngestTokenServer[] = [
    { guildId: "gA", name: "Pulse", label: "" },
    { guildId: "gB", name: "PuGs", label: "Pulse PuGs" },
];

function show(tokens: IngestToken[], onTokensChanged = vi.fn(), activeGuildId = "gA") {
    renderPage(
        <ConnectionsSection
            data={{ ...settings(), activeGuildId }}
            tokens={tokens}
            tokenServers={SERVERS}
            onConfig={vi.fn()}
            onTokensChanged={onTokensChanged}
            icon="settings"
            crumb="Einstellungen"
        />,
    );
    return onTokensChanged;
}

async function openTokens(label: RegExp) {
    await userEvent.click(screen.getByRole("button", { name: label }));
    return within(await screen.findByRole("dialog"));
}

beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(api.assignIngestToken).mockReset().mockResolvedValue({ record: token({ guildId: "gB" }) });
});

describe("SettingsConnections — upload keys per server (#994)", () => {
    it("shows the server of a bound token by its label, else its Discord name", async () => {
        show([token({ id: "t1", name: "PC-A", guildId: "gA" }), token({ id: "t2", name: "PC-B", guildId: "gB" })]);
        const dlg = await openTokens(/Tokens verwalten/);
        const rowA = dlg.getByText("PC-A").closest("tr") as HTMLElement;
        const rowB = dlg.getByText("PC-B").closest("tr") as HTMLElement;
        expect(within(rowA).getByText("Pulse")).toBeInTheDocument();
        expect(within(rowB).getByText("Pulse PuGs")).toBeInTheDocument();
        expect(dlg.queryByRole("combobox")).toBeNull();
        expect(dlg.getByRole("button", { name: /Server/ })).toBeInTheDocument();
    });

    it("shows a personal key (#1000) with its owner instead of a server picker, and lets it be revoked", async () => {
        vi.mocked(api.deleteIngestToken).mockReset().mockResolvedValue({ ok: true } as never);
        const changed = show([token({ id: "p1", name: "Laptop", guildId: "", ownerId: "u7", ownerName: "Mara" })]);
        const dlg = await openTokens(/Tokens verwalten/);
        const row = dlg.getByText("Laptop").closest("tr") as HTMLElement;
        const owner = within(row).getByTestId("token-owner");
        expect(owner).toHaveTextContent("persönlich: Mara");
        expect(owner.getAttribute("data-tip")).toContain("Mara");
        expect(within(row).queryByRole("combobox")).toBeNull();

        await userEvent.click(within(row).getByRole("button", { name: /ckziehen/i }));
        const confirm = await screen.findAllByRole("button", { name: /ckziehen/i });
        await userEvent.click(confirm[confirm.length - 1]);
        await waitFor(() => expect(api.deleteIngestToken).toHaveBeenCalledWith("p1"));
        await waitFor(() => expect(changed).toHaveBeenCalled());
    });

    it("falls back to the owner's Discord id without a name", async () => {
        show([token({ id: "p2", name: "Tower", guildId: "", ownerId: "u8" })]);
        const dlg = await openTokens(/Tokens verwalten/);
        expect(dlg.getByTestId("token-owner")).toHaveTextContent("persönlich: u8");
    });

    it("offers a server picker for a token without a server and binds it", async () => {
        const changed = show([token({ id: "t9", name: "Alt-PC", guildId: "" })]);
        const dlg = await openTokens(/Tokens verwalten/);
        const picker = dlg.getByLabelText("Server für Alt-PC") as HTMLSelectElement;
        expect(within(picker).getByRole("option", { name: "kein Server – zuordnen" })).toBeInTheDocument();
        expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual(["kein Server – zuordnen", "Pulse", "Pulse PuGs"]);

        await userEvent.selectOptions(picker, "gB");
        await waitFor(() => expect(api.assignIngestToken).toHaveBeenCalledWith("t9", "gB"));
        await waitFor(() => expect(changed).toHaveBeenCalled());
    });

    it("does not reload the list when binding fails", async () => {
        vi.mocked(api.assignIngestToken).mockRejectedValue(Object.assign(new Error("Unbekannter Server"), { status: 400 }));
        const changed = show([token({ id: "t9", name: "Alt-PC", guildId: "" })]);
        const dlg = await openTokens(/Tokens verwalten/);
        await userEvent.selectOptions(dlg.getByLabelText("Server für Alt-PC"), "gA");
        await waitFor(() => expect(api.assignIngestToken).toHaveBeenCalledWith("t9", "gA"));
        expect(changed).not.toHaveBeenCalled();
    });

    it("names the server a new token is minted for", async () => {
        show([], vi.fn(), "gB");
        const dlg = await openTokens(/Tokens verwalten/);
        expect(dlg.getByTestId("token-for-server")).toHaveTextContent("Das neue Token gilt für Pulse PuGs.");
        expect(dlg.getByRole("button", { name: /Token erstellen/ })).toBeEnabled();
    });

    // the server refuses with 400 unknown_server; the dialog says why and offers no button
    it("mints nothing without an active server from the list", async () => {
        for (const active of ["", "gX"]) {
            show([], vi.fn(), active);
            const dlg = await openTokens(/Tokens verwalten/);
            expect(dlg.getByTestId("token-for-server")).toHaveTextContent(/Kein aktiver Discord-Server gewählt/);
            const create = dlg.getByRole("button", { name: /Token erstellen/ });
            expect(create).toBeDisabled();
            await userEvent.click(create);
            expect(api.createIngestToken).not.toHaveBeenCalled();
            cleanup();
        }
    });

    describe("in English", () => {
        beforeEach(() => switchLang("en"));
        afterEach(() => switchLang("de"));

        it("names the server of a new token in English", async () => {
            show([], vi.fn(), "gA");
            const dlg = await openTokens(/Manage tokens/);
            expect(dlg.getByTestId("token-for-server")).toHaveTextContent("The new token works for Pulse.");
        });

        it("names the picker and its empty choice in English", async () => {
            show([token({ id: "t9", name: "Alt-PC", guildId: "" })]);
            const dlg = await openTokens(/Manage tokens/);
            const picker = dlg.getByLabelText("Server for Alt-PC");
            expect(within(picker).getByRole("option", { name: "no server – assign" })).toBeInTheDocument();
        });
    });
});

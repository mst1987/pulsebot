// Einstellungen, part "Rollen-Abgleich" (SettingsRoleSync, #264, #896): one line
// per role pair between two servers of the list, add and edit in a dialog with
// two server selects, saved through the shared patch rule; the drift is a badge
// plus a fold-out with profile links per pair, never a remove action.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { AdminConfig, RoleSyncData, RoleSyncServer } from "../../api";
import { renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import RoleSyncPart from "./SettingsRoleSync";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getRoleSync: vi.fn(),
    updateSettings: vi.fn(),
}));

const server = (guildId: string, label: string, roles: { id: string; name: string }[], over: Partial<RoleSyncServer> = {}): RoleSyncServer => ({
    guildId, label, name: `${label} (Discord)`, connected: true, canManage: true, roles, ...over,
});

function roleSync(over: Partial<RoleSyncData> = {}): RoleSyncData {
    return {
        roleSync: [{ fromGuildId: "g1", fromRoleId: "e1", toGuildId: "g2", toRoleId: "t1", direction: "toTarget" }],
        servers: [
            server("g1", "Pulse", [{ id: "e1", name: "Raider" }, { id: "e2", name: "Trial" }]),
            server("g2", "Talk", [{ id: "t1", name: "Raider-Talk" }, { id: "t2", name: "Trial-Talk" }]),
            server("g3", "PuG", [{ id: "p1", name: "PuG-Raider" }]),
        ],
        overlaps: [{ fromGuildId: "g1", toGuildId: "g2", fromCount: 40, toCount: 30, both: 12, error: null }],
        drift: [],
        driftTotal: 0,
        driftError: null,
        lastRun: null,
        ...over,
    };
}

async function show(data: RoleSyncData, waitFor = "@Raider") {
    vi.mocked(api.getRoleSync).mockResolvedValue(data);
    const onConfig = vi.fn();
    renderPage(<RoleSyncPart onConfig={onConfig} />);
    await screen.findByText(waitFor);
    return onConfig;
}

beforeEach(() => {
    vi.mocked(api.getRoleSync).mockReset();
    vi.mocked(api.updateSettings).mockReset();
    vi.mocked(api.updateSettings).mockResolvedValue({ config: { saved: true } as unknown as AdminConfig });
});
afterEach(() => switchLang("de"));

describe("Rollen-Abgleich part", () => {
    it("shows one line per pair with both servers, the arrow and the member overlap", async () => {
        await show(roleSync());
        const row = screen.getByText("@Raider").closest("li")!;
        expect(within(row).getByText("@Raider-Talk")).toBeInTheDocument();
        expect(within(row).getByText("Pulse")).toBeInTheDocument();
        expect(within(row).getByText("Talk")).toBeInTheDocument();
        // the direction as an arrow, spelled out with the server names in its tooltip
        expect(within(row).getByText("→")).toHaveAttribute("data-tip", "Pulse → Talk");
        expect(within(row).getByText("12 von 40 auf beiden")).toBeInTheDocument();
    });

    it("adds a pair between two servers in a modal and saves the whole list", async () => {
        const user = userEvent.setup();
        const onConfig = await show(roleSync());
        await user.click(screen.getByRole("button", { name: "Zuordnung" }));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText("Zuordnung anlegen")).toBeInTheDocument();
        const save = within(dialog).getByRole("button", { name: "Speichern" });
        expect(save).toBeDisabled();

        // the first two servers are preselected; the second is switched to PuG
        expect(within(dialog).getByLabelText("Erster Server")).toHaveValue("g1");
        await user.selectOptions(within(dialog).getByLabelText("Zweiter Server"), "g3");
        const [fromRole, toRole] = within(dialog).getAllByLabelText("Rolle");
        await user.selectOptions(fromRole, "e2");
        await user.selectOptions(toRole, "p1");
        await user.click(within(dialog).getByRole("radio", { name: "Beide" }));
        await user.click(save);

        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({
            roleSync: [
                { fromGuildId: "g1", fromRoleId: "e1", toGuildId: "g2", toRoleId: "t1", direction: "toTarget" },
                { fromGuildId: "g1", fromRoleId: "e2", toGuildId: "g3", toRoleId: "p1", direction: "both" },
            ],
        }));
        await waitFor(() => expect(onConfig).toHaveBeenCalledWith({ saved: true }));
        expect(api.getRoleSync).toHaveBeenCalledTimes(2);
    });

    it("clears the role when its server changes and refuses the same server twice", async () => {
        const user = userEvent.setup();
        await show(roleSync());
        await user.click(screen.getByRole("button", { name: "Zuordnung" }));
        const dialog = screen.getByRole("dialog");
        const [fromRole] = within(dialog).getAllByLabelText("Rolle");
        await user.selectOptions(fromRole, "e2");
        await user.selectOptions(within(dialog).getByLabelText("Erster Server"), "g2");
        expect(within(dialog).getAllByLabelText("Rolle")[0]).toHaveValue("");

        await user.selectOptions(within(dialog).getAllByLabelText("Rolle")[0], "t1");
        await user.selectOptions(within(dialog).getAllByLabelText("Rolle")[1], "t2");
        expect(within(dialog).getByText("Zwei verschiedene Server wählen.")).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Speichern" })).toBeDisabled();
    });

    it("edits a pair in place", async () => {
        const user = userEvent.setup();
        await show(roleSync());
        await user.click(screen.getByRole("button", { name: "Zuordnung bearbeiten" }));
        const dialog = screen.getByRole("dialog");
        await user.click(within(dialog).getByRole("radio", { name: "Zweiter → erster Server" }));
        await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({
            roleSync: [{ fromGuildId: "g1", fromRoleId: "e1", toGuildId: "g2", toRoleId: "t1", direction: "toSource" }],
        }));
    });

    it("shows drift per pair as a badge and a fold-out with profile links, never a remove action", async () => {
        const user = userEvent.setup();
        await show(roleSync({
            driftTotal: 2,
            drift: [{
                ruleIndex: 0, guildId: "g2", sourceGuildId: "g1", roleId: "t1", roleName: "Raider-Talk", sourceRoleId: "e1", sourceRoleName: "Raider",
                guildName: "Pulse Talk", sourceGuildName: "Pulse",
                members: [
                    { userId: "m1", name: "Ahri", notOnSource: false, profileUrl: "https://discord.com/users/m1" },
                    { userId: "m2", name: "Zibbo", notOnSource: true, profileUrl: "https://discord.com/users/m2" },
                ],
            }],
        }));
        expect(screen.getByText("2 Abweichungen")).toHaveClass("badge", "mid");
        expect(screen.getByText(/Pulse Talk/)).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Ahri" })).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Wer" }));
        expect(screen.getByRole("link", { name: "Ahri" })).toHaveAttribute("href", "https://discord.com/users/m1");
        expect(screen.getByRole("link", { name: "Zibbo" })).toHaveAttribute("href", "https://discord.com/users/m2");
        // the sync only adds: nothing here takes a role away
        expect(screen.queryByRole("button", { name: /entfernen|Rolle entfernen/i })).not.toBeInTheDocument();
    });

    it("names the server the bot may not manage roles on", async () => {
        const data = roleSync();
        data.servers[1].canManage = false;
        await show(data);
        expect(screen.getByText(/„Rollen verwalten“ fehlt auf Talk/)).toBeInTheDocument();
    });

    it("says nothing about permissions when the bot may manage the server it writes to", async () => {
        const data = roleSync();
        data.servers[0].canManage = false;
        await show(data);
        expect(screen.queryByText(/„Rollen verwalten“ fehlt/)).not.toBeInTheDocument();
    });

    it("needs two servers before a pair can be added", async () => {
        await show(roleSync({ roleSync: [], servers: [server("g1", "Pulse", [])], overlaps: [] }), "Der Rollen-Abgleich braucht mindestens zwei Server in der Liste.");
        expect(screen.queryByRole("button", { name: "Zuordnung" })).not.toBeInTheDocument();
    });

    it("speaks English once the page is switched", async () => {
        await switchLang("en");
        const data = roleSync({ driftTotal: 3 });
        data.servers[1].canManage = false;
        await show(data);
        expect(screen.getByText("Role sync")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Mapping" })).toBeInTheDocument();
        expect(screen.getByText("3 drifts")).toBeInTheDocument();
        expect(screen.getByText(/"Manage Roles" is missing on Talk/)).toBeInTheDocument();
        const row = screen.getByText("@Raider").closest("li")!;
        expect(within(row).getByText("12 of 40 on both")).toBeInTheDocument();
    });
});

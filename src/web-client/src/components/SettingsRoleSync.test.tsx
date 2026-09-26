// Einstellungen, part "Rollen-Abgleich" (SettingsRoleSync, #264): one line per
// role pair, add and edit in a dialog, saved through the shared patch rule; the
// drift is a badge plus a fold-out with profile links, never a remove action
// (#435: formerly source scans in test/web-client/pingsRoleSync.test.js).
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { AdminConfig, RoleSyncData } from "../api";
import { renderPage } from "../test/render";
import RoleSyncPart from "./SettingsRoleSync";

vi.mock("../api", async (orig) => ({
    ...(await orig<typeof import("../api")>()),
    getRoleSync: vi.fn(),
    updateSettings: vi.fn(),
}));

function roleSync(over: Partial<RoleSyncData> = {}): RoleSyncData {
    return {
        roleSync: [{ eventRoleId: "e1", talkRoleId: "t1", direction: "toTalk" }],
        eventRoles: [{ id: "e1", name: "Raider" }, { id: "e2", name: "Trial" }],
        talkRoles: [{ id: "t1", name: "Raider-Talk" }, { id: "t2", name: "Trial-Talk" }],
        canManage: { event: true, talk: true },
        drift: [],
        driftTotal: 0,
        driftError: null,
        lastRun: null,
        ...over,
    };
}

async function show(data: RoleSyncData) {
    vi.mocked(api.getRoleSync).mockResolvedValue(data);
    const onConfig = vi.fn();
    renderPage(<RoleSyncPart onConfig={onConfig} />);
    await screen.findByText("@Raider");
    return onConfig;
}

beforeEach(() => {
    vi.mocked(api.updateSettings).mockResolvedValue({ config: { saved: true } as unknown as AdminConfig });
});

describe("Rollen-Abgleich part", () => {
    it("shows one line per role pair", async () => {
        await show(roleSync());
        const row = screen.getByText("@Raider").closest("li")!;
        expect(within(row).getByText("@Raider-Talk")).toBeInTheDocument();
        // the direction as an arrow, spelled out in its tooltip
        expect(within(row).getByText("→")).toHaveAttribute("data-tip", "Event → Talk");
    });

    it("adds a pair in a modal and saves the whole list through the shared patch rule", async () => {
        const user = userEvent.setup();
        const onConfig = await show(roleSync());
        await user.click(screen.getByRole("button", { name: "Zuordnung" }));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText("Zuordnung anlegen")).toBeInTheDocument();
        const save = within(dialog).getByRole("button", { name: "Speichern" });
        expect(save).toBeDisabled();

        await user.selectOptions(within(dialog).getByLabelText("Event-Discord"), "e2");
        await user.selectOptions(within(dialog).getByLabelText("Kommunikations-Discord"), "t2");
        await user.click(within(dialog).getByRole("radio", { name: "Beide" }));
        await user.click(save);

        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({
            roleSync: [
                { eventRoleId: "e1", talkRoleId: "t1", direction: "toTalk" },
                { eventRoleId: "e2", talkRoleId: "t2", direction: "both" },
            ],
        }));
        await waitFor(() => expect(onConfig).toHaveBeenCalledWith({ saved: true }));
        expect(api.getRoleSync).toHaveBeenCalledTimes(2);
    });

    it("shows drift as a badge and a fold-out with profile links, never a remove action", async () => {
        const user = userEvent.setup();
        await show(roleSync({
            driftTotal: 2,
            drift: [{
                ruleIndex: 0, side: "talk", roleId: "t1", roleName: "Raider-Talk", sourceRoleId: "e1", sourceRoleName: "Raider", guildName: "Pulse Talk",
                members: [
                    { userId: "m1", name: "Ahri", notOnSource: false, profileUrl: "https://discord.com/users/m1" },
                    { userId: "m2", name: "Zibbo", notOnSource: true, profileUrl: "https://discord.com/users/m2" },
                ],
            }],
        }));
        expect(screen.getByText("2 Abweichungen")).toHaveClass("badge", "mid");
        expect(screen.queryByRole("link", { name: "Ahri" })).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Wer" }));
        expect(screen.getByRole("link", { name: "Ahri" })).toHaveAttribute("href", "https://discord.com/users/m1");
        expect(screen.getByRole("link", { name: "Zibbo" })).toHaveAttribute("href", "https://discord.com/users/m2");
        // the sync only adds: nothing here takes a role away
        expect(screen.queryByRole("button", { name: /entfernen|Rolle entfernen/i })).not.toBeInTheDocument();
    });

    it("says so when the bot may not manage roles", async () => {
        await show(roleSync({ canManage: { event: true, talk: false } }));
        expect(screen.getByText(/„Rollen verwalten“ fehlt auf dem Kommunikations-Discord/)).toBeInTheDocument();
    });

    it("says nothing about permissions when the bot may manage the side it writes to", async () => {
        await show(roleSync({ canManage: { event: false, talk: true } }));
        expect(screen.queryByText(/„Rollen verwalten“ fehlt/)).not.toBeInTheDocument();
    });
});

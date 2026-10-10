// Einstellungen → Berechtigungen: each role row says whether the role is orga or a raider role,
// and a click switches it — the areas of the row stay as they are.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import RolePermissionsEditor from "./RolePermissions";

const areas = [{ id: "raids", label: "Raid-Events", description: "" }, { id: "roster", label: "Roster", description: "" }];
const roles = [{ id: "r-lead", name: "Raidleitung" }, { id: "r-mo", name: "Mo Raider" }];

function show(orgaRoleIds: string[], onOrgaRoleIds = vi.fn(), onChange = vi.fn()) {
    render(
        <RolePermissionsEditor
            areas={areas} roles={roles} adminRoleIds={[]} onAdminRoleIds={vi.fn()}
            value={{ "r-lead": { raids: { read: true, write: true } }, "r-mo": { raids: { read: true, write: false } } }}
            onChange={onChange} baseAccess={{}} onBaseAccessChange={vi.fn()}
            userPermissions={{}} onUserPermissionsChange={vi.fn()} userNames={{}}
            icon="inv_misc_key_03" crumb="Berechtigungen"
            orgaRoleIds={orgaRoleIds} onOrgaRoleIds={onOrgaRoleIds}
        />,
    );
    return { onOrgaRoleIds, onChange };
}

describe("RolePermissionsEditor · orga roles", () => {
    it("marks each role orga or raider as a toggle chip", () => {
        show(["r-lead"]);
        const orga = screen.getByRole("button", { name: t("settings.permissions.orgaOn") });
        expect(orga).toHaveAttribute("aria-pressed", "true");
        expect(orga).toHaveAttribute("data-tip", t("settings.permissions.orgaOnTip", { name: "@Raidleitung" }));
        expect(screen.getByRole("button", { name: t("settings.permissions.orgaOff") })).toHaveAttribute("aria-pressed", "false");
    });

    it("makes a raider role orga and back, without touching the role's areas", async () => {
        const { onOrgaRoleIds, onChange } = show(["r-lead"]);
        await userEvent.click(screen.getByRole("button", { name: t("settings.permissions.orgaOff") }));
        expect(onOrgaRoleIds).toHaveBeenLastCalledWith(["r-lead", "r-mo"]);
        await userEvent.click(screen.getByRole("button", { name: t("settings.permissions.orgaOn") }));
        expect(onOrgaRoleIds).toHaveBeenLastCalledWith([]);
        expect(onChange).not.toHaveBeenCalled();
    });
});

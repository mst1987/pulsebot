// Einstellungen → Berechtigungen (#925): a role this server lacks is named with the server
// it lives on (roleOrigins); "unknown" only when no server of the bot has it any more.
// A full admin role of another server is listed read-only, without a remove button.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import RolePermissionsEditor from "./RolePermissions";
import FullAdminRoles from "./FullAdminRoles";

const areas = [{ id: "raids", label: "Raid-Events", description: "" }];
const roles = [{ id: "r-pug", name: "PuG-Leitung" }];
const origins = {
    "r-orga": { id: "r-orga", name: "Orga", guildId: "g-fresh", guildName: "Pulse Fresh" },
    "r-lead": { id: "r-lead", name: "Raidleitung", guildId: "g-fresh", guildName: "Pulse Fresh" },
};

function show(roleOrigins: Record<string, { id: string; name: string; guildId?: string; guildName?: string }>) {
    return render(
        <RolePermissionsEditor
            areas={areas} roles={roles} adminRoleIds={["r-orga", "r-gone-admin"]}
            value={{
                "r-pug": { raids: { read: true, write: false } },
                "r-lead": { raids: { read: true, write: true } },
                "r-gone": { raids: { read: true, write: false } },
            }}
            onChange={vi.fn()} baseAccess={{}} onBaseAccessChange={vi.fn()}
            userPermissions={{}} onUserPermissionsChange={vi.fn()} userNames={{}}
            icon="inv_misc_key_03" crumb="Berechtigungen"
            roleOrigins={roleOrigins}
        />,
    );
}

describe("RolePermissionsEditor · roles of other servers", () => {
    it("names a full admin role of another server with its server, read-only", () => {
        const { container } = show(origins);
        const admins = container.querySelector(".perm-admins") as HTMLElement;
        const chip = within(admins).getByText("@Orga · Pulse Fresh");
        expect(chip).toHaveAttribute("data-tip-sub", t("settings.permissions.adminOtherServer", { server: "Pulse Fresh" }));
        expect(within(admins).queryByRole("button")).toBeNull();
        expect(within(admins).queryByText(/Unbekannte Rolle \(r-orga\)/)).toBeNull();
    });

    it("calls an admin role unknown only when no server of the bot has it", () => {
        const { container } = show(origins);
        const admins = container.querySelector(".perm-admins") as HTMLElement;
        const gone = within(admins).getByText(t("settings.permissions.unknownRole", { id: "r-gone-admin" }));
        expect(gone).toHaveClass("is-unknown");
    });

    it("hides admin roles it cannot resolve when the server list is not known (no full admin)", () => {
        const { container } = show({});
        const admins = container.querySelector(".perm-admins") as HTMLElement;
        expect(within(admins).queryByText(/r-orga|r-gone-admin/)).toBeNull();
    });

    it("shows a role row of another server with its server and that it does not apply here", () => {
        show(origins);
        const label = screen.getByText("@Raidleitung · Pulse Fresh");
        const row = label.closest("tr") as HTMLElement;
        expect(row).toHaveClass("perm-foreign");
        expect(within(row).getByText(t("settings.permissions.foreignRole", { server: "Pulse Fresh" }))).toBeInTheDocument();
        expect(within(row).getByRole("button", { name: t("settings.permissions.removeHereTip", { name: "@Raidleitung · Pulse Fresh" }) })).toBeInTheDocument();
    });

    it("marks a role row unknown only when the role is on no server any more", () => {
        show(origins);
        const label = screen.getByText(t("settings.permissions.unknownRole", { id: "r-gone" }));
        const row = label.closest("tr") as HTMLElement;
        expect(row).toHaveClass("perm-unknown");
        expect(within(row).getByText(t("settings.permissions.notOnServer"))).toBeInTheDocument();
    });
});

describe("FullAdminRoles · roles the server list lacks", () => {
    it("falls back to roleOrigins for name and server", () => {
        render(
            <FullAdminRoles roles={[]} value={["r-orga"]} onChange={vi.fn()} icon="inv_misc_key_03" crumb="Voll-Admins" title="Voll-Admins"
                roleOrigins={origins} />,
        );
        const name = screen.getByText("@Orga");
        expect(within(name.closest("tr") as HTMLElement).getByText("Pulse Fresh")).toBeInTheDocument();
    });
});

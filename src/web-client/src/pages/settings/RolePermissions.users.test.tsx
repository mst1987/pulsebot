// Einstellungen → Berechtigungen, the per-account rows: each account with its Discord picture, or its initial
// while the bot knows none.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RolePermissionsEditor from "./RolePermissions";

const areas = [{ id: "raids", label: "Raid-Events", description: "" }];

function show(userAvatars?: Record<string, string>) {
    return render(
        <RolePermissionsEditor
            areas={areas} roles={[]} adminRoleIds={[]}
            value={{}} onChange={vi.fn()} baseAccess={{}} onBaseAccessChange={vi.fn()}
            userPermissions={{ "111": { raids: { read: true, write: false } }, "222": { raids: { read: true, write: false } } }}
            onUserPermissionsChange={vi.fn()} userNames={{ "111": "Devihra", "222": "Taccop" }} userAvatars={userAvatars}
            icon="inv_misc_key_03" crumb="Berechtigungen"
        />,
    );
}

const circleOf = (name: string) => screen.getByText(name).closest("tr")?.querySelector(".perm-avatar.round");

describe("RolePermissionsEditor · accounts", () => {
    it("shows an account's Discord picture, the initial for one without", () => {
        show({ "111": "https://cdn/111.png" });
        expect(circleOf("Devihra")?.querySelector("img")).toHaveAttribute("src", "https://cdn/111.png");
        expect(circleOf("Taccop")).toHaveTextContent("T");
        expect(circleOf("Taccop")?.querySelector("img")).toBeNull();
    });

    it("keeps the initials while the server sends no pictures", () => {
        show();
        expect(circleOf("Devihra")).toHaveTextContent("D");
    });
});

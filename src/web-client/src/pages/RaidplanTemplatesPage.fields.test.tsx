// The properties dialog of a raid plan template: three sections, tanks and healers with − and +,
// the melee / ranged split as a switch (no bare checkbox), and what it saves.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import type { GameVersion } from "../api";
import { FieldsModal } from "./RaidplanTemplatesPage";

const VERSION = {
    id: "tbc",
    instances: [
        { id: "bt", short: "BT", name: "Black Temple", icon: "achievement_boss_illidan", sizes: [25], defaultSize: 25, status: "complete", suggested: { 25: { tanks: 3, healers: 7 } } },
        { id: "kara", short: "Kara", name: "Karazhan", icon: "inv_misc_key_07", sizes: [10], defaultSize: 10, status: "complete", suggested: {} },
    ],
} as unknown as GameVersion;

const FIELDS = { name: "BT Demo", category: "Demo", description: "", guildId: "", versionId: "tbc", instanceIds: ["bt"], size: 25, counts: null };

function open(onSave = vi.fn(), fields = FIELDS) {
    render(<FieldsModal title="Eigenschaften" initial={fields} version={VERSION} guilds={[]} onClose={() => {}} onSave={onSave} />);
    return onSave;
}

describe("FieldsModal", () => {
    it("is laid out in three named sections", () => {
        open();
        for (const key of ["planTemplates.sectionGeneral", "planTemplates.sectionRaid", "planTemplates.besetzung"]) {
            expect(screen.getByRole("region", { name: new RegExp(`^${t(key)}`) })).toBeInTheDocument();
        }
        expect(screen.getByLabelText(t("raidBoard.profile.name"))).toHaveValue("BT Demo");
        expect(screen.getByRole("combobox", { name: t("planTemplates.server") })).toHaveValue("");
    });

    it("has no bare checkbox: the split is a switch", () => {
        open();
        const boxes = document.querySelectorAll("input[type=checkbox]");
        expect([...boxes].every((b) => b.getAttribute("role") === "switch")).toBe(true);
        expect(screen.getByRole("switch", { name: t("planTemplates.splitDps") })).not.toBeChecked();
    });

    it("shows melee and ranged once the switch is on and saves what was set", async () => {
        const user = userEvent.setup();
        const onSave = open();
        const besetzung = screen.getByRole("region", { name: new RegExp(`^${t("planTemplates.besetzung")}`) });
        expect(within(besetzung).queryByText(/Nahkämpfer/)).not.toBeInTheDocument();

        await user.click(screen.getByRole("switch", { name: t("planTemplates.splitDps") }));
        expect(within(besetzung).getByText("Nahkämpfer")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: t("planTemplates.stepMore", { role: "Nahkämpfer" }) }));
        await user.click(screen.getByRole("button", { name: t("raidPlan.comp.tankLess") }));

        await user.click(screen.getByRole("button", { name: t("raidBoard.profile.save") }));
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
            name: "BT Demo",
            counts: { tank: 2, healer: 7, dps: 16, melee: 1, ranged: 0 },
        }));
    });

    it("drops melee and ranged when the switch goes off again", async () => {
        const user = userEvent.setup();
        const onSave = open(vi.fn(), { ...FIELDS, counts: { tank: 3, healer: 7, dps: 15, melee: 8, ranged: 7 } });
        const toggle = screen.getByRole("switch", { name: t("planTemplates.splitDps") });
        expect(toggle).toBeChecked();
        await user.click(toggle);
        expect(toggle).not.toBeChecked();
        await user.click(screen.getByRole("button", { name: t("raidBoard.profile.save") }));
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ counts: { tank: 3, healer: 7, dps: 15, melee: 0, ranged: 0 } }));
    });
});

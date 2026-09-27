// The row dialog's "Rolle" (#501): a compact choice next to the class chips (egal / Nahkampf / Fernkampf / Heiler / Tank), stored as the
// row's `preferredRole`; the candidates of a class reference follow it (an elemental shaman for Fernkampf), the wand sends it to the
// server, a row whose task implies a role (healing, tanking) has none. The ranking itself runs in lib/raidplan/rank.test.ts.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RaidplanAssignment, RaidplanBoard, RaidplanPlayer } from "../../../api";
import { t } from "../../../i18n";
import { emptyBoard } from "../../../lib/raidplan/model";
import AssignModal from "./AssignModal";

function P(userId: string, classId: string, role: string, specRole: string): RaidplanPlayer {
    return { userId, character: userId === "ele" ? "Blitzi" : userId === "enh" ? "Hauwech" : userId, classId, className: classId, classColor: "", spec: "", specLabel: "", role, specRole, iconUrl: "", group: 1 };
}
const roster = [P("enh", "Shaman", "melee", "melee"), P("ele", "Shaman", "ranged", "ranged")];

function row(type: string, extra: Partial<RaidplanAssignment> = {}): RaidplanAssignment {
    return { id: "r1", type: type as RaidplanAssignment["type"], title: "", spell: null, assignees: ["class:Shaman:1"], targets: [], note: "", suggested: false, ...extra };
}

function open(a: RaidplanAssignment) {
    const board: RaidplanBoard = { ...emptyBoard(), assignments: [a] };
    const onDone = vi.fn();
    const onSuggest = vi.fn(async () => null);
    render(
        <AssignModal
            board={board} rowId="r1" title="Kick" isEvent roster={roster} catalog={null}
            targetOptions={() => []} spellOptions={() => []} onTarget={(b) => b} onText={(b) => b} onSpell={(b) => b}
            onSuggest={onSuggest} onDone={onDone} onClose={() => undefined} initialSlot="who" initialCat="classes"
        />,
    );
    return { onDone, onSuggest };
}

const roleGroup = () => screen.getByRole("radiogroup", { name: t("raidBoard.amb.prefRoleAria") });
const chosenShaman = () => within(screen.getByRole("radiogroup", { name: /1$/ })).getByRole("radio", { checked: true });

describe("the row dialog's role", () => {
    it("offers the five choices, 'egal' by default, and stores the choice as preferredRole", async () => {
        const { onDone } = open(row("kick"));
        const radios = within(roleGroup()).getAllByRole("radio");
        expect(radios.map((r) => r.textContent)).toEqual(["any", "melee", "ranged", "healer", "tank"].map((r) => t(`raidBoard.amb.prefRoles.${r}`)));
        expect(within(roleGroup()).getByRole("radio", { checked: true })).toHaveTextContent(t("raidBoard.amb.prefRoles.any"));
        await userEvent.click(within(roleGroup()).getByRole("radio", { name: t("raidBoard.amb.prefRoles.ranged") }));
        await userEvent.click(screen.getByRole("button", { name: t("raidBoard.am.done") }));
        expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ id: "r1", preferredRole: "ranged" }), undefined);
    });
    it("the class reference follows the role: Fernkampf takes the elemental shaman, Nahkampf the enhancement one", async () => {
        open(row("kick"));
        expect(chosenShaman()).toHaveTextContent("Hauwech");
        await userEvent.click(within(roleGroup()).getByRole("radio", { name: t("raidBoard.amb.prefRoles.ranged") }));
        expect(chosenShaman()).toHaveTextContent("Blitzi");
        await userEvent.click(within(roleGroup()).getByRole("radio", { name: t("raidBoard.amb.prefRoles.melee") }));
        expect(chosenShaman()).toHaveTextContent("Hauwech");
    });
    it("the wand sends the row's role with the suggestion", async () => {
        const { onSuggest } = open(row("kick", { preferredRole: "ranged" }));
        await userEvent.click(screen.getByRole("button", { name: t("raidBoard.am.suggest") }));
        expect(onSuggest).toHaveBeenCalledWith(expect.objectContaining({ preferredRole: "ranged" }));
    });
    it("a row whose task implies a role (healing) has no role choice", () => {
        open(row("heal", { assignees: [] }));
        expect(screen.queryByRole("radiogroup", { name: t("raidBoard.amb.prefRoleAria") })).toBeNull();
    });
});

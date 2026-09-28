// The row dialog's class priority (#525): "Nach Priorität" is the way a new heal row starts; the class tiles build the order, the count
// is a NumberField, the order chips move with "earlier / later", the resolution shows who it is now; "In Priorität umwandeln" turns
// Paladin 1 + Schamane 1 into 1 x Paladin › Schamane; "Je Klasse fest" takes the priority away. The resolution itself runs in
// lib/raidplan/classPriority.test.ts (both twins).
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RaidplanAssignment, RaidplanBoard, RaidplanPlayer } from "../../../api";
import { t } from "../../../i18n";
import { emptyBoard } from "../../../lib/raidplan/model";
import AssignModal from "./AssignModal";

function P(userId: string, classId: string): RaidplanPlayer {
    return { userId, character: userId, classId, className: classId, classColor: "", spec: "", specLabel: "", role: "healer", specRole: "healer", iconUrl: "", group: 1 };
}

function row(extra: Partial<RaidplanAssignment> = {}): RaidplanAssignment {
    return { id: "r1", type: "heal", title: "", spell: null, assignees: [], targets: [], note: "", suggested: false, ...extra };
}

function open(a: RaidplanAssignment, roster: RaidplanPlayer[] = [P("Lichtbert", "Paladin"), P("Wasserfrau", "Shaman")]) {
    const board: RaidplanBoard = { ...emptyBoard(), assignments: [a] };
    const onDone = vi.fn();
    render(
        <AssignModal
            board={board} rowId="r1" title="Heal" isEvent roster={roster} catalog={null}
            targetOptions={() => []} spellOptions={() => []} onTarget={(b) => b} onText={(b) => b} onSpell={(b) => b}
            onSuggest={vi.fn(async () => null)} onDone={onDone} onClose={() => undefined} initialSlot="who" initialCat="classes"
        />,
    );
    return { onDone };
}

const mode = () => screen.getByRole("radiogroup", { name: t("raidBoard.prio.mode") });
const tile = (cls: string) => screen.getAllByRole("button", { name: t(`wow.class.${cls}`) })[0];
const done = () => userEvent.click(screen.getByRole("button", { name: t("raidBoard.am.done") }));
const prioGroup = () => screen.getByRole("group", { name: t("raidBoard.prio.aria") });

describe("the row dialog's class priority", () => {
    it("a new heal row starts 'Nach Priorität'; tiles build the order, the count and the order are stored", async () => {
        const { onDone } = open(row());
        expect(within(mode()).getByRole("radio", { checked: true })).toHaveTextContent(t("raidBoard.prio.modePrio"));
        await userEvent.click(tile("Paladin"));
        await userEvent.click(tile("Shaman"));
        // the order as chips, 1 and 2
        const list = within(prioGroup()).getByRole("list");
        expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining(t("wow.class.Paladin")), expect.stringContaining(t("wow.class.Shaman"))]);
        // Schamane earlier
        await userEvent.click(within(prioGroup()).getByRole("button", { name: t("raidBoard.prio.earlier", { cls: t("wow.class.Shaman") }) }));
        // count 2
        const count = within(prioGroup()).getByRole("textbox", { name: t("raidBoard.prio.count") });
        fireEvent.change(count, { target: { value: "2" } });
        fireEvent.blur(count);
        await done();
        expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ id: "r1", classPriority: ["Shaman", "Paladin"], count: 2, assignees: [] }), undefined);
    });
    it("shows who it resolves to: the paladin first, the shaman when there is no paladin", async () => {
        open(row({ classPriority: ["Paladin", "Shaman"], count: 1 }));
        expect(screen.getByText(t("raidBoard.prio.resolved")).parentElement).toHaveTextContent("Lichtbert");
    });
    it("without a paladin the shaman moves up", () => {
        open(row({ classPriority: ["Paladin", "Shaman"], count: 1 }), [P("Wasserfrau", "Shaman")]);
        expect(screen.getByText(t("raidBoard.prio.resolved")).parentElement).toHaveTextContent("Wasserfrau");
    });
    it("'In Priorität umwandeln' turns Paladin 1 + Schamane 1 into 1 x Paladin › Schamane", async () => {
        const { onDone } = open(row({ assignees: ["class:Paladin:1", "class:Shaman:1"] }));
        expect(within(mode()).getByRole("radio", { checked: true })).toHaveTextContent(t("raidBoard.prio.modeFixed"));
        await userEvent.click(screen.getByRole("button", { name: t("raidBoard.prio.convert") }));
        await done();
        expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ assignees: [], classPriority: ["Paladin", "Shaman"], count: 1 }), undefined);
    });
    it("'Je Klasse fest' takes the priority and its count away", async () => {
        const { onDone } = open(row({ classPriority: ["Priest"], count: 3 }));
        await userEvent.click(within(mode()).getByRole("radio", { name: t("raidBoard.prio.modeFixed") }));
        await done();
        const saved = onDone.mock.calls[0][0] as RaidplanAssignment;
        expect(saved.classPriority).toBeUndefined();
        expect(saved.count).toBeUndefined();
    });
});

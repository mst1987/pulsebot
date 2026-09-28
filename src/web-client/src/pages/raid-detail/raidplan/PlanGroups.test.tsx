// "Gruppen im Plan" (#529): the chips 1..n + "Bank" in the head of the raid plan - which are on, how many raiders are in the plan, a click
// switches one, the arrow goes back to the default, a reader only sees them.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { IncludedGroups, RaidplanPlayer } from "../../../api";
import PlanGroups from "./PlanGroups";

const P = (userId: string, group: number, extra: Partial<RaidplanPlayer> = {}): RaidplanPlayer => ({ userId, character: userId, classId: "Mage", className: "Magier", classColor: "", spec: "", specLabel: "", role: "ranged", iconUrl: "", group, ...extra });
const ROSTER: RaidplanPlayer[] = [
    ...Array.from({ length: 25 }, (_, i) => P(`p${i}`, Math.floor(i / 5) + 1)),
    P("b1", 0, { bench: true }), P("b2", 0, { bench: true }), P("b3", 0, { bench: true }),
];

function show(included: IncludedGroups, canWrite = true) {
    const onChange = vi.fn();
    const r = render(<PlanGroups roster={ROSTER} groupCount={5} included={included} canWrite={canWrite} busy={false} onChange={onChange} />);
    return { ...r, onChange };
}

describe("PlanGroups", () => {
    it("shows the groups 1-5 on and the bench off by default, 25 raiders in the plan, no reset", () => {
        const { container } = show([1, 2, 3, 4, 5]);
        const chips = Array.from(container.querySelectorAll(".rp-pgroups-chip"));
        expect(chips.map((c) => c.textContent)).toEqual(["1", "2", "3", "4", "5", "Bank"]);
        expect(chips.map((c) => c.getAttribute("aria-pressed"))).toEqual(["true", "true", "true", "true", "true", "false"]);
        expect(container.querySelector(".rp-pgroups-count")!.textContent).toBe("25");
        expect(screen.queryByRole("button", { name: "Zurück auf die Gruppen bis zur Raidgröße" })).toBeNull();
        expect(screen.getByRole("group", { name: "Gruppen im Plan" })).toBeTruthy();
    });

    it("switches the bench on and group 5 off with a click", () => {
        const { onChange } = show([1, 2, 3, 4, 5]);
        fireEvent.click(screen.getByRole("button", { name: "Bank (3)" }));
        expect(onChange).toHaveBeenLastCalledWith([1, 2, 3, 4, 5, "bench"]);
        fireEvent.click(screen.getByRole("button", { name: "Gruppe 5 (5)" }));
        expect(onChange).toHaveBeenLastCalledWith([1, 2, 3, 4]);
    });

    it("counts the bench when it is on and offers the way back to the default", () => {
        const { container, onChange } = show([1, 2, 3, 4, 5, "bench"]);
        expect(container.querySelector(".rp-pgroups-count")!.textContent).toBe("28");
        fireEvent.click(screen.getByRole("button", { name: "Zurück auf die Gruppen bis zur Raidgröße" }));
        expect(onChange).toHaveBeenLastCalledWith(null);
    });

    it("a reader sees the selection but cannot change it; no lineup, no chips", () => {
        const { container } = show([1, 2, 3, 4], false);
        expect(Array.from(container.querySelectorAll(".rp-pgroups-chip")).every((c) => (c as HTMLButtonElement).disabled)).toBe(true);
        expect(container.querySelector(".rp-pgroups-count")!.textContent).toBe("20");
        expect(container.querySelector(".rp-pgroups-reset")).toBeNull();
        const empty = render(<PlanGroups roster={[]} groupCount={5} included={[1]} canWrite busy={false} onChange={() => {}} />);
        expect(empty.container.querySelector(".rp-pgroups")).toBeNull();
    });
});

// The row container's chips and row actions. #556: a class priority stacks its names one per line instead of truncating them side by
// side ("Dru", "Pri", "Sha" was unreadable at 3-4 classes). #559 ("Editor aufgeräumt"): the stack starts at 2 classes, one line per
// class with its rank number and the class colour as a small dot (no arrows); a row that differs from the Standard carries the badge
// "nur dieser Boss"; the inherited rows' hide / lock live behind one "..." menu.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RaidplanAssignment } from "../../../api";
import AssignLine, { PrioChip } from "./AssignLine";
import { classPlaceNameFor, type AssignCtx } from "../../../lib/raidplan/assign";
import { CLASS_COLOR } from "../../../lib/raidplan/classRefs";

const name = (c: string) => classPlaceNameFor(c, "", "heal");

describe("PrioChip (#556, #559)", () => {
    it("1 class: the inline look, nothing stacked", () => {
        const { container } = render(<PrioChip classes={["Paladin"]} count={1} open={false} type="heal" />);
        expect(container.querySelector(".rp-lc-prio.is-stacked")).toBeNull();
        expect(container.querySelectorAll(".rp-lc-pc")).toHaveLength(1);
        expect(screen.getByText("1 x")).not.toBeNull();
        expect(screen.getByText(name("Paladin"))).not.toBeNull();
    });

    it("2 classes already stack: count on top, a rank number and a class-colour dot per line, no arrows or separators", () => {
        const { container } = render(<PrioChip classes={["Paladin", "Shaman"]} count={1} open={false} type="heal" />);
        expect(container.querySelector(".rp-lc-prio.is-stacked")).not.toBeNull();
        const rows = Array.from(container.querySelectorAll(".rp-lc-pcrow"));
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.querySelector(".rp-lc-pcorder")?.textContent)).toEqual(["1", "2"]);
        // the class colour is a small dot (a CSS custom property, no icon)
        expect(rows.map((r) => (r.querySelector(".rp-lc-pcdot") as HTMLElement).style.getPropertyValue("--cc"))).toEqual([CLASS_COLOR.Paladin, CLASS_COLOR.Shaman]);
        expect(container.querySelector(".rp-lc-pcarrow")).toBeNull();
        expect(container.querySelector(".rp-lc-sep")).toBeNull();
        expect(screen.getByText("1 x")).not.toBeNull();
    });

    it("4 classes: every name in full, order numbers 1..4", () => {
        const classes = ["Druid", "Priest", "Shaman", "Paladin"];
        const { container } = render(<PrioChip classes={classes} count={1} open={false} type="heal" />);
        const rows = Array.from(container.querySelectorAll(".rp-lc-pcrow"));
        expect(rows).toHaveLength(4);
        expect(rows.map((r) => r.querySelector(".rp-lc-pcname")?.textContent)).toEqual(classes.map(name));
        expect(rows.map((r) => r.querySelector(".rp-lc-pcorder")?.textContent)).toEqual(["1", "2", "3", "4"]);
    });

    it("an open (missing) stacked priority still shows the warning", () => {
        render(<PrioChip classes={["Druid", "Priest", "Shaman"]} count={1} open type="heal" />);
        expect(screen.getByText(name("Druid"))).not.toBeNull();
        expect(document.querySelector(".rp-lc-prio.is-open")).not.toBeNull();
    });
});

const ctx: AssignCtx = { slots: [], players: new Map(), catalog: null, filled: [], groupColors: {}, groupMarks: {}, icons: [] };
const row = (extra: Partial<RaidplanAssignment> = {}): RaidplanAssignment => ({
    id: "r1", type: "heal", assignees: [], targets: [{ kind: "group", ref: "3" }], note: "", title: "", spell: null, suggested: false, ...extra,
} as unknown as RaidplanAssignment);

describe("AssignLine actions and badge (#559)", () => {
    it("a deviating row carries the badge 'nur dieser Boss' and the light background class, a plain row does not", () => {
        const { container, rerender } = render(<ul><AssignLine a={row()} filled={row()} ctx={ctx} isEvent={false} onOpen={vi.fn()} deviating /></ul>);
        expect(screen.getByText("nur dieser Boss")).not.toBeNull();
        expect(container.querySelector(".rp-line.is-dev")).not.toBeNull();
        rerender(<ul><AssignLine a={row()} filled={row()} ctx={ctx} isEvent={false} onOpen={vi.fn()} /></ul>);
        expect(screen.queryByText("nur dieser Boss")).toBeNull();
        expect(container.querySelector(".rp-line.is-dev")).toBeNull();
    });

    it("an inherited row shows the pencil and ONE '...' button; the hide entry and the lock note sit in its menu, no 'Standard' label", () => {
        const onHide = vi.fn();
        const { container } = render(<ul><AssignLine a={row()} filled={row()} ctx={ctx} isEvent={false} inherited onOpen={vi.fn()} onHide={onHide} /></ul>);
        expect(screen.queryByText("Standard")).toBeNull();
        expect(container.querySelector(".rp-line-open")).not.toBeNull();
        expect(screen.queryByRole("button", { name: /Für diesen Boss ausblenden/ })).toBeNull();
        const more = screen.getByRole("button", { name: /Weitere Aktionen/ });
        expect(more.getAttribute("aria-haspopup")).toBe("menu");
        expect(more.getAttribute("aria-expanded")).toBe("false");
        fireEvent.click(more);
        expect(more.getAttribute("aria-expanded")).toBe("true");
        expect(screen.getByRole("menu")).not.toBeNull();
        expect(screen.getByRole("menuitem", { name: /Vom Standard geerbt/ }).getAttribute("aria-disabled")).toBe("true");
        fireEvent.click(screen.getByRole("menuitem", { name: /Für diesen Boss ausblenden/ }));
        expect(onHide).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("menu")).toBeNull();
    });
});

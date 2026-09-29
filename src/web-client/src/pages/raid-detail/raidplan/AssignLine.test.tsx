// The row container's chips, since #556: a class priority of 3+ classes stacks its names one per line instead of truncating them
// side by side ("Dru", "Pri", "Sha" was unreadable at 3-4 classes); 1-2 classes keep the compact inline "Paladin › Schamane" look.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrioChip } from "./AssignLine";
import { classPlaceNameFor } from "../../../lib/raidplan/assign";

const name = (c: string) => classPlaceNameFor(c, "", "heal");

describe("PrioChip (#556)", () => {
    it("2 classes: the inline layout, joined with the arrow, nothing stacked", () => {
        const { container } = render(<PrioChip classes={["Paladin", "Shaman"]} count={1} open={false} type="heal" />);
        expect(container.querySelector(".rp-lc-prio.is-stacked")).toBeNull();
        expect(container.querySelectorAll(".rp-lc-pc")).toHaveLength(2);
        expect(container.querySelector(".rp-lc-sep")).not.toBeNull();
        expect(screen.getByText("1 x")).not.toBeNull();
        expect(screen.getByText(name("Paladin"))).not.toBeNull();
        expect(screen.getByText(name("Shaman"))).not.toBeNull();
    });

    it("4 classes: stacked one per line, every name in full, an order number per row, no separator arrows", () => {
        const classes = ["Druid", "Priest", "Shaman", "Paladin"];
        const { container } = render(<PrioChip classes={classes} count={1} open={false} type="heal" />);
        expect(container.querySelector(".rp-lc-prio.is-stacked")).not.toBeNull();
        const rows = Array.from(container.querySelectorAll(".rp-lc-pcrow"));
        expect(rows).toHaveLength(4);
        // every class name shows in full, never cut off
        expect(rows.map((r) => r.querySelector(".rp-lc-pcname")?.textContent)).toEqual(classes.map(name));
        // the priority order stays visible as a small order number per row
        expect(rows.map((r) => r.querySelector(".rp-lc-pcorder")?.textContent)).toEqual(["1", "2", "3", "4"]);
        // a down arrow connects a row to the next one, but not after the last row
        expect(rows[0].querySelector(".rp-lc-pcarrow")).not.toBeNull();
        expect(rows[3].querySelector(".rp-lc-pcarrow")).toBeNull();
        expect(container.querySelector(".rp-lc-sep")).toBeNull();
        expect(screen.getByText("1 x")).not.toBeNull();
    });

    it("3 classes already stack (the threshold is \">= 3\", not \"> 3\")", () => {
        const { container } = render(<PrioChip classes={["Druid", "Priest", "Shaman"]} count={2} open={false} type="heal" />);
        expect(container.querySelector(".rp-lc-prio.is-stacked")).not.toBeNull();
        expect(container.querySelectorAll(".rp-lc-pcrow")).toHaveLength(3);
    });

    it("an open (missing) stacked priority still shows the warning", () => {
        render(<PrioChip classes={["Druid", "Priest", "Shaman"]} count={1} open type="heal" />);
        expect(screen.getByText(name("Druid"))).not.toBeNull();
        expect(document.querySelector(".rp-lc-prio.is-open")).not.toBeNull();
    });
});

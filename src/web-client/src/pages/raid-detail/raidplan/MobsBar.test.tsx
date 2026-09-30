// The mobs bar folds like the other editor blocks, and (#559) its chevron sits in the title's head line, left of the title, the same
// place as in the Besetzung, the tactic and the assignment cards.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MobsBar from "./MobsBar";
import { emptyBoard } from "../../../lib/raidplan/model";

beforeEach(() => { window.localStorage.clear(); });

describe("MobsBar head line (#559)", () => {
    it("the chevron is the first element of the head line, before the title", () => {
        render(<MobsBar mobs={[]} board={emptyBoard()} catalog={null} bossKey="" instanceId="" canWrite edit={vi.fn()} />);
        const top = document.querySelector(".rp-bes-top") as HTMLElement;
        expect(top.firstElementChild?.getAttribute("aria-expanded")).toBe("true");
        expect(top.children[1].textContent).toContain("·");
        fireEvent.click(screen.getByRole("button", { name: /Einklappen/ }));
        expect(document.querySelector(".rp-achips")).toBeNull();
    });
});

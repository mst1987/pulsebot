// The assignment cards (HEAL, TANK, …) since #556: the chevron already there folds the card, and now the fold is remembered
// in this browser per card type - it used to reset on every boss switch (`useEffect(() => setFolded([]), [scope, eventId])`).
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AssignPanel from "./AssignPanel";
import { emptyBoard } from "../../../lib/raidplan/model";
import { addRowOfType } from "../../../lib/raidplan/assign";
import { JobsProvider } from "../../../components/Jobs";
import { ConfirmProvider } from "../../../components/ui/Modal";
import type { RaidplanBoard } from "../../../api";

function setup(board: RaidplanBoard = emptyBoard()) {
    return render(
        <JobsProvider>
            <ConfirmProvider>
                <AssignPanel
                    scope="boss" board={board} edit={vi.fn()} roster={[]} players={new Map()} isEvent={false} canWrite
                    eventId="" groupCount={1} links onLinks={vi.fn()} catalog={null} sectionMobs={[]}
                />
            </ConfirmProvider>
        </JobsProvider>,
    );
}

beforeEach(() => { window.localStorage.clear(); });

const withRow = (extra: Record<string, unknown> = {}): RaidplanBoard => {
    const made = addRowOfType(emptyBoard(), "heal");
    return { ...made.board, assignments: made.board.assignments.map((a) => ({ ...a, targets: [{ kind: "group", ref: "3" }], ...extra })) } as RaidplanBoard;
};

describe("AssignPanel cards tidied (#559)", () => {
    it("the chevron is the first thing in the card head, before the type badge (no row of its own)", () => {
        setup();
        const head = screen.getByRole("region", { name: "Heilen" }).querySelector(".rp-acard-head") as HTMLElement;
        const first = head.firstElementChild as HTMLElement;
        expect(first.getAttribute("aria-expanded")).toBe("true");
        expect(head.querySelectorAll("button[aria-expanded]")).toHaveLength(1);
    });

    it("the head has the text buttons 'Auto-Füllen' and '+ Zeile' instead of the wand icon", () => {
        setup();
        const heal = screen.getByRole("region", { name: "Heilen" });
        const auto = screen.getByRole("button", { name: /Heilen: aus dem Setup vorschlagen/ });
        expect(auto.textContent).toBe("Auto-Füllen");
        expect(heal.contains(auto)).toBe(true);
        expect(heal.querySelector(".rp-acard-head svg.lucide-wand-2, .rp-acard-head svg.lucide-wand-sparkles")).toBeNull();
        expect(heal.querySelector(".rp-acard-add")).not.toBeNull();
    });

    it("one column header row 'Wer (Priorität)' / 'Auf' per card that has rows, none while every row is empty", () => {
        const empty = setup();
        expect(document.querySelector(".rp-linehead")).toBeNull();
        empty.unmount();
        setup(withRow());
        const heads = document.querySelectorAll(".rp-linehead");
        expect(heads).toHaveLength(1);
        expect(heads[0].textContent).toContain("Wer (Priorität)");
        expect(heads[0].textContent).toContain("Auf");
        // no 'Default' / 'Standard' label under the row
        expect(document.querySelector(".rp-line-std")).toBeNull();
    });

    it("only a row that differs from the Standard gets the badge, and the head counts it ('1 abweichend')", () => {
        setup(withRow({ origin: "d1" }));
        const heal = screen.getByRole("region", { name: "Heilen" });
        expect(heal.querySelectorAll(".rp-line-dev")).toHaveLength(1);
        expect(heal.querySelector(".rp-line.is-dev")).not.toBeNull();
        expect(heal.querySelector(".rp-acard-sum")?.textContent).toContain("1 abweichend");
    });

    it("a plain own row has no badge and no 'abweichend'", () => {
        setup(withRow());
        const heal = screen.getByRole("region", { name: "Heilen" });
        expect(heal.querySelector(".rp-line-dev")).toBeNull();
        expect(heal.querySelector(".rp-acard-sum")?.textContent).not.toContain("abweichend");
    });
});

describe("AssignPanel cards (#556)", () => {
    it("the HEAL card's chevron folds its rows and is remembered across a remount, other cards are untouched", () => {
        const first = setup();
        const healCard = screen.getByRole("region", { name: "Heilen" });
        const tankCard = screen.getByRole("region", { name: "Main-Tank / Tanken" });
        expect(healCard.querySelector(".rp-linelist")).not.toBeNull();
        fireEvent.click(healCard.querySelector("button[aria-expanded]") as HTMLElement);
        expect(healCard.querySelector(".rp-linelist")).toBeNull();
        // the tank card, a different type, keeps its own fold state
        expect(tankCard.querySelector(".rp-linelist")).not.toBeNull();
        first.unmount();

        setup();
        const healAgain = screen.getByRole("region", { name: "Heilen" });
        expect(healAgain.querySelector(".rp-linelist")).toBeNull();
        expect(screen.getByRole("region", { name: "Main-Tank / Tanken" }).querySelector(".rp-linelist")).not.toBeNull();
    });
});

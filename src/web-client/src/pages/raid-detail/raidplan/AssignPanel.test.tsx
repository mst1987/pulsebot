// The assignment cards (HEAL, TANK, …) since #556: the chevron already there folds the card, and now the fold is remembered
// in this browser per card type - it used to reset on every boss switch (`useEffect(() => setFolded([]), [scope, eventId])`).
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AssignPanel from "./AssignPanel";
import { emptyBoard } from "../../../lib/raidplan/model";
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

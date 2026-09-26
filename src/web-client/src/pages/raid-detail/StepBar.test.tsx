// The step bar of an own event (#319) as drawn from what the server sends
// (src/web/events/raidDetailSteps.js' eventSteps): the route in the server's order,
// the open step marked with the one loud button, every other step quiet, the
// one-line summary a phone falls back to, and no native title or glyph icons.
// The words behind it run in lib/raidSteps.test.ts; the wiring into the page
// in RaidDetailPage.steps.test.tsx.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RaidEventSteps } from "../../api";
import { t } from "../../i18n";
import { deedLabel, stepStateLabel, stepSummary, stepTitle } from "../../lib/raidSteps";
import { requireBackend } from "../../test/backend";
import { eventStep, ownSteps } from "../../test/fixtures/raidDetail";
import StepBar from "./StepBar";

const { eventSteps } = requireBackend("web/events/raidDetailSteps");

const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);
const inHours = (h: number) => Math.floor((NOW + h * 3600 * 1000) / 1000);

/** What the server answers for an own event two days ahead with one signup. */
function fromServer(): RaidEventSteps {
    return eventSteps({
        event: { id: "eh-1", source: "eventhelper", title: "SSC + TK", channelName: "mi-23-09", startTime: inHours(48), size: 25, signupDeadline: inHours(24), isPast: false, status: "active" },
        ownSignups: [{ status: "signed" }],
        attendance: { responded: [], missing: [] },
        signupTarget: 25, lootItems: [], eventLogs: [],
    }, { now: NOW });
}

function draw(progress: RaidEventSteps, running = false) {
    const onDeed = vi.fn();
    const view = render(<StepBar progress={progress} running={running} onDeed={onDeed} />);
    return { ...view, onDeed };
}

describe("the step bar", () => {
    it("draws the route the server sent, in its order — a step it does not know by its label", () => {
        const server = fromServer();
        const { container } = draw(server);
        const items = within(screen.getByRole("list")).getAllByRole("listitem");
        expect(items).toHaveLength(server.steps.length);
        server.steps.forEach((step, i) => expect(items[i]).toHaveTextContent(stepTitle(step)));
        container.remove();

        const own = ownSteps();
        draw({ ...own, steps: [...own.steps, eventStep("future" as "after", { label: "Ganz neu" })] });
        const last = within(screen.getByRole("list")).getAllByRole("listitem").at(-1);
        expect(last).toHaveTextContent("Ganz neu");
    });

    it("marks the open step and gives only it a loud button, the other steps lead there quietly", async () => {
        const user = userEvent.setup();
        const progress = ownSteps();
        const { onDeed } = draw(progress);
        const items = within(screen.getByRole("list")).getAllByRole("listitem");
        const current = items[1];
        expect(current).toHaveTextContent(stepStateLabel("current"));
        // the open step's tile is no button itself; its deed is the one button in it
        const loud = within(current).getByRole("button");
        expect(loud).toHaveTextContent(deedLabel(progress.action!));
        await user.click(loud);
        expect(onDeed).toHaveBeenCalledWith(progress.action);

        // a quiet step with a deed is a button as a whole, named by its state and what a click does
        const setup = progress.steps[2];
        const quiet = screen.getByRole("button", { name: t("raidDetail.stepBar.deedAria", { label: stepTitle(setup), state: stepStateLabel(setup.state), action: deedLabel(setup.action!) }) });
        await user.click(quiet);
        expect(onDeed).toHaveBeenLastCalledWith(setup.action);
        // a step without a deed is not clickable at all
        expect(within(items[3]).queryByRole("button")).not.toBeInTheDocument();
        // one loud button in the whole bar
        expect(screen.getAllByRole("button").filter((b) => !b.getAttribute("aria-label"))).toHaveLength(1);
    });

    it("says „übersprungen“ for a skipped step, with its reason in the tooltip", () => {
        draw(ownSteps());
        const skipped = within(screen.getByRole("list")).getAllByRole("listitem")[3];
        expect(skipped).toHaveTextContent(stepStateLabel("skipped"));
        expect(skipped.querySelector("[data-tip-sub]")).toHaveAttribute("data-tip-sub", "Ohne Setup keine Freigabe.");
    });

    it("carries the line a phone falls back to: „Schritt n von 5 · Label“", () => {
        const progress = ownSteps();
        draw(progress);
        expect(screen.getByText(stepSummary(progress))).toBeInTheDocument();
        expect(stepSummary(progress)).toBe("Schritt 2 von 5 · Anmeldung");
    });

    it("shows a cancelled raid as one line with the way back, no route", async () => {
        const user = userEvent.setup();
        const reopen = { id: "reopen", label: "Absage zurücknehmen", icon: "spell_holy_divineintervention", manage: "reopen" as const };
        const { onDeed } = draw({ ...ownSteps(), cancelled: true, current: "", note: "Abgesagt: zu wenige", action: reopen });
        expect(screen.queryByRole("list")).not.toBeInTheDocument();
        expect(screen.getByText("Abgesagt: zu wenige")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: deedLabel(reopen) }));
        expect(onDeed).toHaveBeenCalledWith(reopen);
    });

    it("carries no native title and no glyph icons", () => {
        const { container } = draw(ownSteps());
        expect(container.querySelector("[title]")).toBeNull();
        expect(/[✕×↗✓✗○🎉]/u.test(container.textContent || "")).toBe(false);
    });
});

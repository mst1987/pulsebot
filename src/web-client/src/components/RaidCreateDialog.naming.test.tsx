// The create dialog's channel name (#285): the server suggests it and says
// where it comes from — one badge; a hand-typed name says so instead.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import RaidCreateDialog from "./RaidCreateDialog";
import { renderPage } from "../test/render";
import { t } from "../i18n";
import { stepLabel } from "../lib/eventPlan";
import type { ChannelNameSuggestion, RaidCreateContext } from "../api";

vi.mock("../api", async (orig) => ({
    ...(await orig<typeof import("../api")>()),
    getRaidCreateContext: vi.fn(),
    getChannelNameSuggestion: vi.fn(),
}));

/** 17.09.2026 19:30 Berlin. */
const START = Math.floor(Date.UTC(2026, 8, 17, 17, 30) / 1000);

function context(): RaidCreateContext {
    return {
        defaults: { templateId: "rh1", channelId: "" },
        categoryTemplates: {},
        leaderId: "u1",
        leaderCandidates: [{ id: "u1", name: "Admin" }],
        channels: [{ id: "c-mi", name: "mi-17-09-ssc", type: 0, typeLabel: "Text", category: "Raids", parentId: "cat1", isThread: false }],
        templates: [],
        reusableEvents: [{
            id: "e1", title: "SSC Mittwoch", templateId: "rh1", description: "", channelId: "c-mi", channelName: "mi-17-09-ssc",
            categoryId: "cat1", categoryName: "Raids", startTime: START, contentIds: [],
        }],
        categories: [{ id: "cat1", name: "Raids" }],
        versions: [],
    };
}

const suggestion: ChannelNameSuggestion = {
    name: "mi-24-09-ssc", replaced: [{ part: "date", from: "17-09", to: "24-09" }],
    source: "previous", label: "abgeleitet aus #mi-17-09-ssc", detail: "Datum ersetzt", design: "Rechte wie #mi-17-09-ssc",
    fromChannel: "c-mi", templateChannelId: "c-mi", templateChannelName: "mi-17-09-ssc",
};

async function openAtChannelStep() {
    const user = userEvent.setup();
    renderPage(<RaidCreateDialog open sourceId="e1" userId="u1" onClose={() => undefined} onCreated={() => undefined} />);
    // "Wiederholen" jumps straight to the date; one step on is the channel
    const next = await screen.findByRole("button", { name: new RegExp(t("raidCreate.footer.next", { step: stepLabel("kanal") }).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    await waitFor(() => expect(next).toBeEnabled());
    await user.click(next);
    return user;
}

beforeEach(() => {
    vi.mocked(api.getRaidCreateContext).mockResolvedValue(context());
    vi.mocked(api.getChannelNameSuggestion).mockResolvedValue(suggestion);
});

describe("RaidCreateDialog — the channel name suggestion", () => {
    it("asks the server for the name and shows where it comes from", async () => {
        await openAtChannelStep();
        const field = await screen.findByDisplayValue("mi-24-09-ssc");
        expect(api.getChannelNameSuggestion).toHaveBeenLastCalledWith({ categoryId: "cat1", date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), instanceIds: [], sourceEventId: "e1" });
        const badge = within(screen.getByRole("dialog")).getByText("abgeleitet aus #mi-17-09-ssc");
        expect(badge).toHaveAttribute("data-tip-sub", "Datum ersetzt · Rechte wie #mi-17-09-ssc");
        expect(field).toHaveAttribute("data-tip-sub", expect.stringContaining("abgeleitet aus #mi-17-09-ssc"));
    });

    it("says 'manual' instead once the name is typed by hand", async () => {
        const user = await openAtChannelStep();
        const field = await screen.findByDisplayValue("mi-24-09-ssc");
        await user.clear(field);
        await user.type(field, "mein-raid");
        expect(screen.getByText(t("raidCreate.kanal.manual"))).toBeInTheDocument();
        expect(screen.queryByText("abgeleitet aus #mi-17-09-ssc")).not.toBeInTheDocument();
    });
});

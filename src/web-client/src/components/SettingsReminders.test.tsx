// Einstellungen, part "Erinnerungen" (SettingsReminders, #264): one line per
// raid category with what is set, the details in a dialog, the target only with
// the talk server's ping channel, and never a bare category id (#435: formerly
// source scans in test/web-client/pingsRoleSync.test.js).
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { AdminConfig, RemindersData } from "../api";
import { renderPage } from "../test/render";
import RemindersPart from "./SettingsReminders";

vi.mock("../api", async (orig) => ({
    ...(await orig<typeof import("../api")>()),
    getReminders: vi.fn(),
    updateSettings: vi.fn(),
}));

const UNKNOWN_ID = "123456789012345678";

function reminders(over: Partial<RemindersData> = {}): RemindersData {
    return {
        categoryReminders: { c1: { missingHours: 24, signedHours: 1, target: "event" } },
        categories: [{ id: "c1", name: "Raids Mittwoch", roleCount: 1 }, { id: "c2", name: "Raids Sonntag", roleCount: 1 }],
        pingTargets: { talk: false, talkGuildName: "", talkChannelName: "" },
        lastRun: null,
        ...over,
    };
}

async function show(data: RemindersData) {
    vi.mocked(api.getReminders).mockResolvedValue(data);
    const onConfig = vi.fn();
    renderPage(<RemindersPart onConfig={onConfig} />);
    await screen.findByText(data.categories[0].name || "Unbekannte Kategorie");
    return onConfig;
}

const row = (name: string) => screen.getByText(name).closest("li")!;

beforeEach(() => {
    vi.mocked(api.updateSettings).mockResolvedValue({ config: { saved: true } as unknown as AdminConfig });
});

describe("Erinnerungen part", () => {
    it("is one line per category with the summary, details in a modal", async () => {
        const user = userEvent.setup();
        const onConfig = await show(reminders());
        expect(within(row("Raids Mittwoch")).getByText("24 h vor Schluss · 1 h vor Raid")).toBeInTheDocument();
        expect(within(row("Raids Sonntag")).getByText("aus")).toBeInTheDocument();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

        await user.click(within(row("Raids Sonntag")).getByRole("button", { name: "Erinnerungen bearbeiten" }));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText("Raids Sonntag")).toBeInTheDocument();
        await user.type(within(dialog).getByLabelText("Fehlende · h vorher"), "12");
        await user.click(within(dialog).getByRole("button", { name: "Speichern" }));

        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({
            categoryReminders: {
                c1: { missingHours: 24, signedHours: 1, target: "event" },
                c2: { missingHours: 12, signedHours: 0, target: "event" },
            },
        }));
        await waitFor(() => expect(onConfig).toHaveBeenCalledWith({ saved: true }));
    });

    it("never shows a bare category id: an unknown category is named as such, the id in the tooltip", async () => {
        await show(reminders({ categories: [{ id: UNKNOWN_ID, name: "", roleCount: 0 }], categoryReminders: {} }));
        const unknown = screen.getByText("Unbekannte Kategorie");
        expect(unknown).toHaveAttribute("data-tip", "Unbekannte Kategorie");
        expect(unknown.getAttribute("data-tip-sub")).toContain(`Kategorie-ID ${UNKNOWN_ID}`);
        expect(screen.queryByText(UNKNOWN_ID, { exact: false })).not.toBeInTheDocument();
    });

    it("offers the target only with a talk ping channel", async () => {
        const user = userEvent.setup();
        await show(reminders());
        await user.click(within(row("Raids Mittwoch")).getByRole("button", { name: "Erinnerungen bearbeiten" }));
        expect(within(screen.getByRole("dialog")).queryByRole("radiogroup")).not.toBeInTheDocument();
    });

    it("sends the chosen target when the talk server has a ping channel", async () => {
        const user = userEvent.setup();
        await show(reminders({ pingTargets: { talk: true, talkGuildName: "Pulse Talk", talkChannelName: "pings" } }));
        await user.click(within(row("Raids Mittwoch")).getByRole("button", { name: "Erinnerungen bearbeiten" }));
        const dialog = screen.getByRole("dialog");
        await user.click(within(within(dialog).getByRole("radiogroup", { name: "Wohin" })).getByRole("radio", { name: "Talk" }));
        await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
        await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({
            categoryReminders: { c1: { missingHours: 24, signedHours: 1, target: "talk" } },
        }));
    });
});

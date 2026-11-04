// Alle Server › Einstellungen › Tarife: the plain table of the servers' plans, saved at once.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../../api";
import type { ServerPlansView } from "../../../../api";
import { t } from "../../../../i18n";
import { switchLang } from "../../../../test/i18n";
import { renderPage } from "../../../../test/render";
import ServerPlansSection from "../ServerPlansSection";

vi.mock("../../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../../api")>()),
    getServerPlans: vi.fn(),
    saveServerPlan: vi.fn(),
}));

const ROW = { guildId: "g1", name: "Raidgilde", plan: "free", until: "", note: "", expired: false, state: "known" as const };

function view(over: Partial<ServerPlansView> = {}): ServerPlansView {
    return { plans: ["free", "plus"], maxNote: 200, servers: [ROW], ...over };
}

beforeEach(() => {
    vi.mocked(api.getServerPlans).mockReset().mockResolvedValue(view());
    vi.mocked(api.saveServerPlan).mockReset().mockResolvedValue(view());
});
afterEach(() => switchLang("de"));

describe("ServerPlansSection", () => {
    it("lists the servers in a table with plan, end date and note", async () => {
        renderPage(<ServerPlansSection />);
        expect(await screen.findByText("Raidgilde")).toBeInTheDocument();
        for (const name of ["server", "plan", "until", "note"]) {
            expect(screen.getByRole("columnheader", { name: t(`settings.serverPlans.${name}`) })).toBeInTheDocument();
        }
        expect(screen.getByRole("combobox", { name: t("settings.serverPlans.planOf", { name: "Raidgilde" }) })).toHaveValue("free");
    });

    it("saves a new plan at once, with the rest of the row", async () => {
        renderPage(<ServerPlansSection />);
        await userEvent.selectOptions(await screen.findByRole("combobox", { name: t("settings.serverPlans.planOf", { name: "Raidgilde" }) }), "plus");
        await waitFor(() => expect(api.saveServerPlan).toHaveBeenCalledWith({ guildId: "g1", plan: "plus", until: "", note: "" }));
    });

    it("saves the end date and the note on leaving the field, and only when they changed", async () => {
        renderPage(<ServerPlansSection />);
        const note = await screen.findByRole("textbox", { name: t("settings.serverPlans.noteOf", { name: "Raidgilde" }) });
        fireEvent.blur(note);
        expect(api.saveServerPlan).not.toHaveBeenCalled();

        await userEvent.type(note, "Testserver");
        fireEvent.blur(note);
        await waitFor(() => expect(api.saveServerPlan).toHaveBeenCalledWith({ guildId: "g1", plan: "free", until: "", note: "Testserver" }));

        vi.mocked(api.saveServerPlan).mockClear();
        const until = screen.getByLabelText(t("settings.serverPlans.untilOf", { name: "Raidgilde" }));
        fireEvent.change(until, { target: { value: "2027-01-31" } });
        fireEvent.blur(until);
        await waitFor(() => expect(api.saveServerPlan).toHaveBeenCalledWith({ guildId: "g1", plan: "free", until: "2027-01-31", note: "" }));
    });

    it("keeps a saved end date when the field holds a half-typed one", async () => {
        vi.mocked(api.getServerPlans).mockResolvedValue(view({ servers: [{ ...ROW, until: "2027-01-31" }] }));
        renderPage(<ServerPlansSection />);
        const until = await screen.findByLabelText(t("settings.serverPlans.untilOf", { name: "Raidgilde" }));
        fireEvent.change(until, { target: { value: "" } });
        // jsdom has no partly filled date field, so its verdict is set by hand
        Object.defineProperty(until, "validity", { configurable: true, value: { badInput: true } });
        fireEvent.blur(until);
        expect(api.saveServerPlan).not.toHaveBeenCalled();
    });

    it("clears the end date when the field was emptied on purpose", async () => {
        vi.mocked(api.getServerPlans).mockResolvedValue(view({ servers: [{ ...ROW, until: "2027-01-31" }] }));
        renderPage(<ServerPlansSection />);
        const until = await screen.findByLabelText(t("settings.serverPlans.untilOf", { name: "Raidgilde" }));
        fireEvent.change(until, { target: { value: "" } });
        fireEvent.blur(until);
        await waitFor(() => expect(api.saveServerPlan).toHaveBeenCalledWith({ guildId: "g1", plan: "free", until: "", note: "" }));
    });

    it("says when a date has run out and when the bot has left a server", async () => {
        vi.mocked(api.getServerPlans).mockResolvedValue(view({
            servers: [{ ...ROW, until: "2020-01-01", expired: true }, { ...ROW, guildId: "g2", name: "", state: "gone" }],
        }));
        renderPage(<ServerPlansSection />);
        expect(await screen.findByText(t("settings.serverPlans.expired"))).toBeInTheDocument();
        expect(screen.getByText(t("settings.serverPlans.gone", { id: "g2" }))).toBeInTheDocument();
    });

    it("does not call a server gone while Discord does not answer", async () => {
        vi.mocked(api.getServerPlans).mockResolvedValue(view({
            servers: [{ ...ROW, state: "unknown" }, { ...ROW, guildId: "g2", name: "", state: "unknown" }],
        }));
        renderPage(<ServerPlansSection />);
        expect(await screen.findByText("Raidgilde")).toBeInTheDocument();
        expect(screen.getByText(t("settings.serverPlans.unknown", { id: "g2" }))).toBeInTheDocument();
        expect(screen.queryByText(t("settings.serverPlans.gone", { id: "g2" }))).not.toBeInTheDocument();
    });

    it("keeps the table when saving fails", async () => {
        vi.mocked(api.saveServerPlan).mockRejectedValue(Object.assign(new Error("Datum ungültig"), { status: 400 }));
        renderPage(<ServerPlansSection />);
        await userEvent.selectOptions(await screen.findByRole("combobox", { name: t("settings.serverPlans.planOf", { name: "Raidgilde" }) }), "plus");
        expect(await screen.findByText("Datum ungültig")).toBeInTheDocument();
        expect(screen.getByText("Raidgilde")).toBeInTheDocument();
    });

    it("says when the list cannot be loaded", async () => {
        vi.mocked(api.getServerPlans).mockRejectedValue(new Error("nope"));
        renderPage(<ServerPlansSection />);
        expect(await screen.findByText(t("settings.serverPlans.loadError"))).toBeInTheDocument();
    });

    it("speaks English", async () => {
        switchLang("en");
        renderPage(<ServerPlansSection />);
        expect(await screen.findByRole("columnheader", { name: "Plan" })).toBeInTheDocument();
        expect(screen.getByRole("columnheader", { name: "Valid until" })).toBeInTheDocument();
    });
});

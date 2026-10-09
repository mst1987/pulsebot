// "Ab- & Anwesenheit" on the signup page: the raider's entries as small rows,
// deleting one behind the confirm dialog, and the two buttons that open the
// dialog. The dialog itself is tested in AvailabilityDialog.test.tsx.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { AvailabilityData, AvailabilityEntry } from "../../api";
import { t } from "../../i18n";
import { periodLabel } from "../../lib/signups/availability";
import { specLabel } from "../../lib/wow/wowNames";
import { switchLang } from "../../test/i18n";
import { renderPage } from "../../test/render";
import AvailabilitySection from "./AvailabilitySection";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getAvailability: vi.fn(),
    deleteAvailability: vi.fn(),
    previewAvailability: vi.fn(),
}));

const entry = (over: Partial<AvailabilityEntry> = {}): AvailabilityEntry => ({
    id: "av1", kind: "absence", from: "2026-10-05", to: "2026-10-09", comment: "Urlaub", character: "", spec: "", specLabel: "",
    versionId: "", categoryId: "", categoryName: "", byOrga: false, done: 2, ...over,
});

const DATA: AvailabilityData = {
    userId: "u1", name: "Zibbo", orga: false, today: "2026-10-05", maxDays: 180, characters: [],
    entries: [
        entry(),
        entry({ id: "av2", kind: "presence", from: "2026-10-12", to: "2026-10-12", comment: "", character: "Zibbo", spec: "Priest-Holy", specLabel: "Holy", byOrga: true, done: 0 }),
    ],
};

async function show(data: AvailabilityData = DATA) {
    vi.mocked(api.getAvailability).mockResolvedValue(data);
    const onChanged = vi.fn();
    renderPage(<AvailabilitySection onChanged={onChanged} />);
    await screen.findByText(t("signups.availability.title"));
    return { onChanged };
}

beforeEach(() => {
    vi.mocked(api.deleteAvailability).mockResolvedValue({ id: "av1" });
    vi.mocked(api.previewAvailability).mockResolvedValue({ raids: [] });
});

afterEach(() => switchLang("de"));

describe("AvailabilitySection", () => {
    it("lists every entry: the period large, the reason or character · spec small, who entered it", async () => {
        await show();
        expect(screen.getByText(periodLabel("2026-10-05", "2026-10-09"))).toBeInTheDocument();
        expect(screen.getByText(t("signups.quoted", { text: "Urlaub" }))).toBeInTheDocument();
        expect(screen.getByText(t("signups.availability.done", { count: 2 }))).toBeInTheDocument();
        expect(screen.getByText(periodLabel("2026-10-12", "2026-10-12"))).toBeInTheDocument();
        expect(screen.getByText(`Zibbo · ${specLabel("Priest-Holy", "Holy")}`)).toBeInTheDocument();
        expect(screen.getAllByText(t("signups.availability.byOrga"))).toHaveLength(1);
        expect(screen.getByRole("img", { name: t("signups.availability.kind.absence") })).toBeInTheDocument();
        expect(screen.getByRole("img", { name: t("signups.availability.kind.presence") })).toBeInTheDocument();
    });

    it("deletes an entry only after the confirmation", async () => {
        const user = userEvent.setup();
        await show();
        const [first] = screen.getAllByRole("button", { name: t("signups.availability.remove") });
        await user.click(first);
        expect(await screen.findByText(t("signups.availability.removeTitle"))).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: t("common.delete") }));
        expect(api.deleteAvailability).toHaveBeenCalledWith("av1");
        await waitFor(() => expect(screen.queryByText(periodLabel("2026-10-05", "2026-10-09"))).not.toBeInTheDocument());
        expect(screen.getByText(t("signups.availability.removed"))).toBeInTheDocument();
    });

    it("keeps the entry when the confirmation is cancelled", async () => {
        const user = userEvent.setup();
        await show();
        await user.click(screen.getAllByRole("button", { name: t("signups.availability.remove") })[0]);
        await user.click(await screen.findByRole("button", { name: t("common.cancel") }));
        expect(api.deleteAvailability).not.toHaveBeenCalled();
        expect(screen.getByText(periodLabel("2026-10-05", "2026-10-09"))).toBeInTheDocument();
    });

    it("opens the dialog on the kind of its button", async () => {
        const user = userEvent.setup();
        await show({ ...DATA, entries: [] });
        expect(screen.queryByRole("list")).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: t("signups.availability.addAbsence") }));
        expect(screen.getByText(t("signups.availability.dialog.titleAbsence"), { selector: ".dlg-title" })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: t("common.cancel") }));
        await user.click(screen.getByRole("button", { name: t("signups.availability.addPresence") }));
        expect(screen.getByText(t("signups.availability.dialog.titlePresence"), { selector: ".dlg-title" })).toBeInTheDocument();
    });

    it("says it in English too", async () => {
        await switchLang("en");
        await show();
        expect(screen.getByText("Absence & attendance")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Enter absence" })).toBeInTheDocument();
        expect(screen.getByText("by the raid lead")).toBeInTheDocument();
    });

    it("shows a quiet line when the entries cannot be loaded", async () => {
        vi.mocked(api.getAvailability).mockRejectedValue({ code: "x", message: "offline" });
        renderPage(<AvailabilitySection onChanged={vi.fn()} />);
        expect(await screen.findByText(t("signups.availability.loadError", { message: "offline" }))).toBeInTheDocument();
    });
});

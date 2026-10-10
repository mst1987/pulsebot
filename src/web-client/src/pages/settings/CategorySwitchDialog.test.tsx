// The confirmation dialog of a category's version switch (#738): what it says
// when nothing needs fixing, and when the preview cannot be loaded. The flow
// through the settings page is in SettingsPage.sections.test.tsx.
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { renderPage } from "../../test/render";
import CategorySwitchDialog from "./CategorySwitchDialog";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getCategorySwitch: vi.fn(),
}));

const fitting: api.CategorySwitchPreview = {
    categoryId: "cat1", name: "Montag",
    from: { id: "tbc", label: "TBC Anniversary", short: "TBC" }, to: { id: "forever", label: "WoW Forever", short: "Forever" },
    switching: true, eras: [],
    upcoming: [],
    series: { enabled: true, usesDefault: false, template: { id: "t-fe", name: "Onyxia 40", versionId: "forever" }, fits: true },
    defaultTemplate: { id: "t-fe", name: "Onyxia 40", versionId: "forever", fits: true },
    templates: [{ id: "t-fe", name: "Onyxia 40" }],
};

beforeEach(() => {
    vi.mocked(api.getCategorySwitch).mockReset();
});

describe("CategorySwitchDialog (#738)", () => {
    it("asks for no fix when series and default template fit, and confirms without one", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getCategorySwitch).mockResolvedValue(fitting);
        const onConfirm = vi.fn();
        renderPage(<CategorySwitchDialog categoryId="cat1" categoryName="" versionId="forever" onCancel={() => {}} onConfirm={onConfirm} />);
        expect(await screen.findByText("Die Serie passt zur neuen Version.")).toBeInTheDocument();
        expect(screen.getByText("Die Standard-Vorlage „Onyxia 40“ passt.")).toBeInTheDocument();
        expect(screen.getByText("Montag: TBC Anniversary → WoW Forever")).toBeInTheDocument();
        expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Auf Forever umstellen" }));
        expect(onConfirm).toHaveBeenCalledWith({ series: "" });
    });

    it("says when there is no template of the new version yet", async () => {
        vi.mocked(api.getCategorySwitch).mockResolvedValue({ ...fitting, series: null, templates: [], defaultTemplate: { id: "t-tbc", name: "Kara", versionId: "tbc", fits: false } });
        renderPage(<CategorySwitchDialog categoryId="cat1" categoryName="Montag" versionId="forever" onCancel={() => {}} onConfirm={() => {}} />);
        expect(await screen.findByText("Die Standard-Vorlage „Kara“ ist TBC und passt nicht mehr.")).toBeInTheDocument();
        expect(screen.getByText(/Für Forever gibt es noch keine Raid-Vorlage/)).toBeInTheDocument();
    });

    it("shows a load error and keeps the switch disabled", async () => {
        vi.mocked(api.getCategorySwitch).mockRejectedValue(Object.assign(new Error("kaputt"), { status: 500 }));
        const onCancel = vi.fn();
        renderPage(<CategorySwitchDialog categoryId="cat1" categoryName="Montag" versionId="forever" onCancel={onCancel} onConfirm={() => {}} />);
        expect(await screen.findByText("Konnte nicht geladen werden: kaputt")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Auf forever umstellen" })).toBeDisabled();
        await userEvent.setup().click(screen.getByRole("button", { name: "Abbrechen" }));
        expect(onCancel).toHaveBeenCalled();
    });
});

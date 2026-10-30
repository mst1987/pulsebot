// The confirmation dialog of a category's version switch (#738): what it says
// when nothing needs fixing, and when the preview cannot be loaded. The flow
// through the settings page is in SettingsPage.sections.test.tsx.
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import { renderPage } from "../../../test/render";
import CategorySwitchDialog from "../CategorySwitchDialog";

vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
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

    it("says the roster closes and offers a roster for the new version with the people and picked roles (#739)", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getCategorySwitch).mockResolvedValue({
            ...fitting,
            roster: { closing: { id: "r-tbc", name: "Montag", members: 12 }, existing: null, canCreate: true },
        });
        const onConfirm = vi.fn();
        const roles = [{ id: "500000000000000001", name: "Raider" }, { id: "500000000000000002", name: "Forever-Raider" }];
        renderPage(<CategorySwitchDialog categoryId="cat1" categoryName="Montag" versionId="forever" roles={roles} onCancel={() => {}} onConfirm={onConfirm} />);
        expect(await screen.findByText(/Roster „Montag“ wird abgeschlossen. Es bleibt unter TBC lesbar/)).toBeInTheDocument();
        const create = screen.getByRole("switch", { name: "Forever-Roster anlegen" });
        const copy = screen.getByRole("switch", { name: "Personen übernehmen" });
        expect(create).toBeChecked();
        expect(copy).toBeChecked();
        expect(copy.closest("label")).toHaveAttribute("data-tip-sub", "12 Personen kommen als Probe ins neue Roster, ohne Charakter – jeder wählt seinen Forever-Charakter selbst.");
        expect(screen.getByText(/Keine Rolle gewählt/)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "@Forever-Raider" }));
        expect(screen.getByRole("button", { name: "@Forever-Raider" })).toHaveAttribute("aria-pressed", "true");
        await user.click(copy);
        await user.click(screen.getByRole("button", { name: "Auf Forever umstellen" }));
        expect(onConfirm).toHaveBeenCalledWith({ series: "", roster: { create: true, copyMembers: false, roleIds: ["500000000000000002"] } });
    });

    it("offers no chip for a role a bot owns (@MEE6, #745)", async () => {
        vi.mocked(api.getCategorySwitch).mockResolvedValue({
            ...fitting,
            roster: { closing: { id: "r-tbc", name: "Montag", members: 2 }, existing: null, canCreate: true },
        });
        const roles = [{ id: "500000000000000001", name: "Raider" }, { id: "500000000000000003", name: "MEE6", managed: true }];
        renderPage(<CategorySwitchDialog categoryId="cat1" categoryName="Montag" versionId="forever" roles={roles} onCancel={() => {}} onConfirm={() => {}} />);
        expect(await screen.findByRole("button", { name: "@Raider" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "@MEE6" })).not.toBeInTheDocument();
    });

    it("can switch without a new roster", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getCategorySwitch).mockResolvedValue({
            ...fitting,
            roster: { closing: { id: "r-tbc", name: "Montag", members: 3 }, existing: null, canCreate: true },
        });
        const onConfirm = vi.fn();
        renderPage(<CategorySwitchDialog categoryId="cat1" categoryName="Montag" versionId="forever" onCancel={() => {}} onConfirm={onConfirm} />);
        await user.click(await screen.findByRole("switch", { name: "Forever-Roster anlegen" }));
        expect(screen.queryByRole("switch", { name: "Personen übernehmen" })).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Auf Forever umstellen" }));
        expect(onConfirm).toHaveBeenCalledWith({ series: "", roster: { create: false, copyMembers: true, roleIds: [] } });
    });

    it("names an existing roster of the new version that opens again, offering no new one", async () => {
        vi.mocked(api.getCategorySwitch).mockResolvedValue({
            ...fitting,
            roster: { closing: { id: "r-fe", name: "Montag F", members: 3 }, existing: { id: "r-tbc", name: "Montag", closed: true, reopens: true }, canCreate: false },
        });
        renderPage(<CategorySwitchDialog categoryId="cat1" categoryName="Montag" versionId="forever" onCancel={() => {}} onConfirm={() => {}} />);
        expect(await screen.findByText("Das Forever-Roster „Montag“ wird wieder geöffnet.")).toBeInTheDocument();
        expect(screen.queryByRole("switch")).not.toBeInTheDocument();
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

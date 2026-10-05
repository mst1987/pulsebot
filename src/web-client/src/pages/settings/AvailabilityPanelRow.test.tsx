// The absence/attendance panel of a raid category (Einstellungen → Kategorien):
// it posts and removes at once through the panel API, outside the page's draft.
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { AvailabilityLink, AvailabilityPanel } from "../../api";
import { t } from "../../i18n";
import { renderPage } from "../../test/render";
import AvailabilityPanelRow from "./AvailabilityPanelRow";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    postAvailabilityPanel: vi.fn(),
    removeAvailabilityPanel: vi.fn(),
    saveAvailabilityLinks: vi.fn(),
}));

const CHANNELS = [{ id: "ch1", name: "abwesenheit", category: "T4" }, { id: "ch2", name: "raid-info" }];
const PANEL: AvailabilityPanel = { categoryId: "c1", channelId: "ch2", postedAt: Date.UTC(2026, 9, 3, 10), url: "https://discord.com/channels/1/ch2/9" };

function show(panels: AvailabilityPanel[] = [], channels = CHANNELS, links: Record<string, AvailabilityLink[]> = {}, maxLinks = 5) {
    const onChange = vi.fn();
    const onLinks = vi.fn();
    renderPage(<AvailabilityPanelRow categoryId="c1" categoryName="T4" panels={{ panels, channels, links, maxLinks, onChange, onLinks }} />);
    return { onChange, onLinks };
}

const channelSelect = () => screen.getByRole("combobox", { name: t("settings.categories.panelChannelAria", { name: "T4" }) });

beforeEach(() => {
    vi.mocked(api.postAvailabilityPanel).mockResolvedValue({ panel: { ...PANEL, channelId: "ch1" } });
    vi.mocked(api.removeAvailabilityPanel).mockResolvedValue({ categoryId: "c1" });
    vi.mocked(api.saveAvailabilityLinks).mockReset().mockImplementation(async (categoryId, links) => ({ categoryId, links }));
});

describe("AvailabilityPanelRow", () => {
    it("posts the panel into the picked channel at once", async () => {
        const user = userEvent.setup();
        const { onChange } = show();
        const post = screen.getByRole("button", { name: t("settings.categories.panelPost") });
        expect(post).toBeDisabled();
        await user.selectOptions(channelSelect(), "ch1");
        await user.click(post);
        expect(api.postAvailabilityPanel).toHaveBeenCalledWith("c1", "ch1");
        expect(onChange).toHaveBeenCalledWith("c1", { ...PANEL, channelId: "ch1" });
        expect(await screen.findByText(t("settings.categories.panelPosted"))).toBeInTheDocument();
    });

    it("shows a posted panel: its channel, a link to it, post again and remove", async () => {
        const user = userEvent.setup();
        const { onChange } = show([PANEL]);
        expect(channelSelect()).toHaveValue("ch2");
        expect(screen.getByRole("button", { name: t("settings.categories.panelRepost") })).toBeEnabled();
        expect(screen.getByRole("link", { name: t("settings.categories.panelView") })).toHaveAttribute("href", PANEL.url);

        await user.click(screen.getByRole("button", { name: t("common.remove") }));
        expect(await screen.findByText(t("settings.categories.panelRemoveTitle"))).toBeInTheDocument();
        // the confirm dialog's own button carries the same word
        const confirm = screen.getAllByRole("button", { name: t("common.remove") }).at(-1);
        if (!confirm) throw new Error("no confirm button");
        await user.click(confirm);
        expect(api.removeAvailabilityPanel).toHaveBeenCalledWith("c1");
        expect(onChange).toHaveBeenCalledWith("c1", null);
    });

    it("shows the server's reason when posting fails", async () => {
        const user = userEvent.setup();
        vi.mocked(api.postAvailabilityPanel).mockRejectedValue({ code: "bad_request", message: "Das Panel konnte nicht gepostet werden: Missing Access" });
        const { onChange } = show([PANEL]);
        await user.click(screen.getByRole("button", { name: t("settings.categories.panelRepost") }));
        expect(await screen.findByText("Das Panel konnte nicht gepostet werden: Missing Access")).toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
    });

    it("says why there is nothing to pick without channels", () => {
        show([], []);
        expect(screen.getByText(t("settings.categories.panelNoChannels"))).toBeInTheDocument();
    });

    describe("links in the organizer", () => {
        const WCL = { label: "WCL", url: "https://www.warcraftlogs.com/x" };
        const labelInput = (n: number) => screen.getByRole("textbox", { name: t("settings.categories.linkLabelAria", { n }) });
        const urlInput = (n: number) => screen.getByLabelText(t("settings.categories.linkUrlAria", { n }));
        const addButton = () => screen.getByRole("button", { name: t("settings.categories.linkAdd") });
        const saveButton = () => screen.getByRole("button", { name: t("settings.categories.linksSave") });

        it("shows the hint and no rows for a category without links, with a disabled-free add button", () => {
            show();
            expect(screen.getByText(t("settings.categories.links"))).toBeInTheDocument();
            expect(screen.getByText(t("settings.categories.linksSub"))).toBeInTheDocument();
            expect(screen.queryByRole("textbox", { name: /Link 1/ })).not.toBeInTheDocument();
            expect(addButton()).toBeEnabled();
        });

        it("lists the saved links of this category only", () => {
            show([], CHANNELS, { c1: [WCL], c2: [{ label: "Other", url: "https://other.example" }] });
            expect(labelInput(1)).toHaveValue("WCL");
            expect(urlInput(1)).toHaveValue("https://www.warcraftlogs.com/x");
            expect(urlInput(1)).toHaveAttribute("type", "url");
            expect(labelInput(1)).toHaveAttribute("maxlength", "40");
            expect(screen.queryByDisplayValue("Other")).not.toBeInTheDocument();
        });

        it("adds and removes rows, and stops adding at the limit", async () => {
            const user = userEvent.setup();
            show([], CHANNELS, { c1: [WCL] }, 2);
            await user.click(addButton());
            expect(labelInput(2)).toHaveValue("");
            expect(addButton()).toBeDisabled();
            await user.click(screen.getByRole("button", { name: t("settings.categories.linkRemove", { n: 1 }) }));
            expect(labelInput(1)).toHaveValue("");
            expect(screen.queryByRole("textbox", { name: t("settings.categories.linkLabelAria", { n: 2 }) })).not.toBeInTheDocument();
            expect(addButton()).toBeEnabled();
        });

        it("saves the trimmed rows through the API, drops empty ones and says so", async () => {
            const user = userEvent.setup();
            const { onLinks } = show();
            await user.click(addButton());
            await user.type(labelInput(1), "  Info ");
            await user.type(urlInput(1), " https://sheet.example/x ");
            await user.click(addButton());
            await user.click(saveButton());
            expect(api.saveAvailabilityLinks).toHaveBeenCalledWith("c1", [{ label: "Info", url: "https://sheet.example/x" }]);
            expect(onLinks).toHaveBeenCalledWith("c1", [{ label: "Info", url: "https://sheet.example/x" }]);
            expect(await screen.findByText(t("settings.categories.linksSaved"))).toBeInTheDocument();
            // the rows now show what the server kept: the empty one is gone
            expect(screen.queryByRole("textbox", { name: t("settings.categories.linkLabelAria", { n: 2 }) })).not.toBeInTheDocument();
        });

        it("saves an emptied list to remove the links", async () => {
            const user = userEvent.setup();
            const { onLinks } = show([], CHANNELS, { c1: [WCL] });
            await user.click(screen.getByRole("button", { name: t("settings.categories.linkRemove", { n: 1 }) }));
            await user.click(saveButton());
            expect(api.saveAvailabilityLinks).toHaveBeenCalledWith("c1", []);
            expect(onLinks).toHaveBeenCalledWith("c1", []);
        });

        it("shows the server's error as a toast and keeps the rows", async () => {
            const user = userEvent.setup();
            vi.mocked(api.saveAvailabilityLinks).mockRejectedValue({ code: "bad_request", message: "„Info“ braucht eine Adresse mit https://." });
            const { onLinks } = show([], CHANNELS, { c1: [{ label: "Info", url: "ftp://x" }] });
            await user.click(saveButton());
            expect(await screen.findByText("„Info“ braucht eine Adresse mit https://.")).toBeInTheDocument();
            expect(onLinks).not.toHaveBeenCalled();
            expect(labelInput(1)).toHaveValue("Info");
        });

        it("does not touch the panel API", async () => {
            const user = userEvent.setup();
            show();
            await user.click(addButton());
            await user.click(saveButton());
            expect(api.postAvailabilityPanel).not.toHaveBeenCalled();
            expect(api.removeAvailabilityPanel).not.toHaveBeenCalled();
        });
    });
});

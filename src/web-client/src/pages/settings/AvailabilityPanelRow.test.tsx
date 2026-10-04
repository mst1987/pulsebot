// The absence/attendance panel of a raid category (Einstellungen → Kategorien):
// it posts and removes at once through the panel API, outside the page's draft.
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { AvailabilityPanel } from "../../api";
import { t } from "../../i18n";
import { renderPage } from "../../test/render";
import AvailabilityPanelRow from "./AvailabilityPanelRow";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    postAvailabilityPanel: vi.fn(),
    removeAvailabilityPanel: vi.fn(),
}));

const CHANNELS = [{ id: "ch1", name: "abwesenheit", category: "T4" }, { id: "ch2", name: "raid-info" }];
const PANEL: AvailabilityPanel = { categoryId: "c1", channelId: "ch2", postedAt: Date.UTC(2026, 9, 3, 10), url: "https://discord.com/channels/1/ch2/9" };

function show(panels: AvailabilityPanel[] = [], channels = CHANNELS) {
    const onChange = vi.fn();
    renderPage(<AvailabilityPanelRow categoryId="c1" categoryName="T4" panels={{ panels, channels, onChange }} />);
    return { onChange };
}

const channelSelect = () => screen.getByRole("combobox", { name: t("settings.categories.panelChannelAria", { name: "T4" }) });

beforeEach(() => {
    vi.mocked(api.postAvailabilityPanel).mockResolvedValue({ panel: { ...PANEL, channelId: "ch1" } });
    vi.mocked(api.removeAvailabilityPanel).mockResolvedValue({ categoryId: "c1" });
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
});

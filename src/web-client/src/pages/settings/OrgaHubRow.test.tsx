// The Orga-Zentrale of a raid category (Einstellungen → Kategorien → Setup & Planung):
// it posts and removes at once through its own API, outside the page's draft.
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { OrgaHub } from "../../api";
import { t } from "../../i18n";
import { renderPage } from "../../test/render";
import OrgaHubRow from "./OrgaHubRow";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    postOrgaHub: vi.fn(),
    removeOrgaHub: vi.fn(),
}));

const CHANNELS = [{ id: "ch1", name: "orga", category: "Orga" }, { id: "ch2", name: "raidleitung" }];
const HUB: OrgaHub = { categoryId: "c1", channelId: "ch2", postedAt: Date.UTC(2026, 9, 3, 10), url: "https://discord.com/channels/1/ch2/9" };

function show(hubs: OrgaHub[] = [], channels = CHANNELS) {
    const onChange = vi.fn();
    renderPage(<OrgaHubRow categoryId="c1" categoryName="T4" hubs={{ hubs, channels, onChange }} />);
    return { onChange };
}

const channelSelect = () => screen.getByRole("combobox", { name: t("settings.categories.orgaHubChannelAria", { name: "T4" }) });

beforeEach(() => {
    vi.mocked(api.postOrgaHub).mockReset().mockResolvedValue({ hub: { ...HUB, channelId: "ch1" } });
    vi.mocked(api.removeOrgaHub).mockReset().mockResolvedValue({ categoryId: "c1" });
});

describe("OrgaHubRow", () => {
    it("posts the hub into the picked channel at once", async () => {
        const user = userEvent.setup();
        const { onChange } = show();
        expect(screen.getByText(t("settings.categories.orgaHub"))).toBeInTheDocument();
        const post = screen.getByRole("button", { name: t("settings.categories.panelPost") });
        expect(post).toBeDisabled();
        await user.selectOptions(channelSelect(), "ch1");
        await user.click(post);
        expect(api.postOrgaHub).toHaveBeenCalledWith("c1", "ch1");
        expect(onChange).toHaveBeenCalledWith("c1", { ...HUB, channelId: "ch1" });
        expect(await screen.findByText(t("settings.categories.orgaHubPosted"))).toBeInTheDocument();
    });

    it("shows a posted hub: its channel, a link to it, post again and remove after asking", async () => {
        const user = userEvent.setup();
        const { onChange } = show([HUB]);
        expect(channelSelect()).toHaveValue("ch2");
        expect(screen.getByRole("button", { name: t("settings.categories.panelRepost") })).toBeEnabled();
        expect(screen.getByRole("link", { name: t("settings.categories.panelView") })).toHaveAttribute("href", HUB.url);

        await user.click(screen.getByRole("button", { name: t("common.remove") }));
        expect(await screen.findByText(t("settings.categories.orgaHubRemoveTitle"))).toBeInTheDocument();
        await user.click(screen.getAllByRole("button", { name: t("common.remove") }).at(-1)!);
        expect(api.removeOrgaHub).toHaveBeenCalledWith("c1");
        expect(onChange).toHaveBeenCalledWith("c1", null);
    });

    it("names a refused post", async () => {
        const user = userEvent.setup();
        vi.mocked(api.postOrgaHub).mockRejectedValue({ message: "Kein Kanal gewählt." });
        show([HUB]);
        await user.click(screen.getByRole("button", { name: t("settings.categories.panelRepost") }));
        expect(await screen.findByText("Kein Kanal gewählt.")).toBeInTheDocument();
    });

    it("says when there is no channel to post into", () => {
        show([], []);
        expect(screen.getByText(t("settings.categories.panelNoChannels"))).toBeInTheDocument();
        expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });
});

// Einstellungen → Module → Addons, "Downloadzentrale im Discord": channel and
// role and game version saved at once through the own route; post, post again, view, remove.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { AddonCenterView } from "../../api";
import { t } from "../../i18n";
import { renderPage } from "../../test/render";
import AddonCenterCard from "./AddonCenterCard";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getAddonCenter: vi.fn(),
    saveAddonCenter: vi.fn(),
    postAddonCenter: vi.fn(),
    removeAddonCenter: vi.fn(),
}));

const POSTED_AT = Date.UTC(2026, 9, 13, 10, 0);
const CHECKED_AT = Date.UTC(2026, 9, 13, 16, 15);

function view(over: Partial<AddonCenterView> = {}): AddonCenterView {
    return {
        settings: { channelId: "", roleId: "", versionId: "" },
        center: null,
        checkedAt: 0,
        online: true,
        channels: [
            { id: "c1", name: "addon-downloads", guildId: "g1", category: "WoW Forever" },
            { id: "c2", name: "talk", guildId: "g2", category: "WoW Forever" },
        ],
        roles: { g1: [{ id: "r1", name: "Addon-Updates" }], g2: [{ id: "r2", name: "Talk-Updates" }] },
        versions: [{ id: "tbc", label: "TBC Anniversary" }, { id: "classic", label: "Classic" }, { id: "forever", label: "WoW Forever" }],
        autoVersion: null,
        ...over,
    };
}
const posted = (over: Partial<AddonCenterView> = {}) => view({
    settings: { channelId: "c1", roleId: "r1", versionId: "" },
    autoVersion: { id: "tbc", label: "TBC Anniversary" },
    center: { channelId: "c1", postedAt: POSTED_AT, url: "https://discord.com/channels/g1/c1/m1" },
    checkedAt: CHECKED_AT,
    ...over,
});

const channel = () => screen.getByRole("combobox", { name: t("addon.center.channel") });
const role = () => screen.getByRole("combobox", { name: t("addon.center.role") });
const version = () => screen.getByRole("combobox", { name: t("addon.center.version") });

beforeEach(() => {
    vi.mocked(api.getAddonCenter).mockResolvedValue(view());
    vi.mocked(api.saveAddonCenter).mockImplementation(async (patch) => view({ settings: { ...view().settings, ...patch } }));
    vi.mocked(api.postAddonCenter).mockResolvedValue(posted());
    vi.mocked(api.removeAddonCenter).mockResolvedValue(view({ settings: { channelId: "c1", roleId: "r1", versionId: "" } }));
});

describe("AddonCenterCard", () => {
    it("shows the heading, the note, the channel and role pickers; posting waits for a channel", async () => {
        renderPage(<AddonCenterCard />);
        expect(await screen.findByRole("heading", { name: t("addon.center.title") })).toBeInTheDocument();
        expect(screen.getByText(t("addon.center.note"))).toBeInTheDocument();
        expect(channel()).toHaveValue("");
        expect(screen.getByRole("option", { name: "#addon-downloads · WoW Forever" })).toBeInTheDocument();
        expect(role()).toHaveValue("");
        expect(screen.queryByRole("switch")).toBeNull();
        expect(screen.getByRole("button", { name: t("addon.center.post") })).toBeDisabled();
        expect(screen.getByText(t("addon.center.pickChannel"))).toBeInTheDocument();
    });

    it("saves a picked channel and role at once, each alone", async () => {
        const user = userEvent.setup();
        renderPage(<AddonCenterCard />);
        await user.selectOptions(await screen.findByRole("combobox", { name: t("addon.center.channel") }), "c1");
        expect(api.saveAddonCenter).toHaveBeenLastCalledWith({ channelId: "c1" });
        expect(await screen.findByText(t("addon.center.saved"))).toBeInTheDocument();
        await waitFor(() => expect(channel()).toHaveValue("c1"));
        await user.selectOptions(role(), "r1");
        expect(api.saveAddonCenter).toHaveBeenLastCalledWith({ roleId: "r1" });
    });

    it("offers the roles of the channel's server and drops the role when the channel moves to another server", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getAddonCenter).mockResolvedValue(posted());
        renderPage(<AddonCenterCard />);
        await screen.findByRole("heading", { name: t("addon.center.title") });
        expect(screen.getByRole("option", { name: "@Addon-Updates" })).toBeInTheDocument();
        expect(screen.queryByRole("option", { name: "@Talk-Updates" })).not.toBeInTheDocument();
        await user.selectOptions(channel(), "c2");
        expect(api.saveAddonCenter).toHaveBeenLastCalledWith({ channelId: "c2", roleId: "" });
    });

    it("offers the game versions with an automatic first entry that names the category's version, and saves a pick at once", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getAddonCenter).mockResolvedValue(posted());
        renderPage(<AddonCenterCard />);
        await screen.findByRole("heading", { name: t("addon.center.title") });
        expect(version()).toHaveValue("");
        expect(screen.getByRole("option", { name: "Automatisch (TBC Anniversary)" })).toBeInTheDocument();
        expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(expect.arrayContaining(["TBC Anniversary", "Classic", "WoW Forever"]));
        await user.selectOptions(version(), "forever");
        expect(api.saveAddonCenter).toHaveBeenLastCalledWith({ versionId: "forever" });
        expect(await screen.findByText(t("addon.center.saved"))).toBeInTheDocument();
        await waitFor(() => expect(version()).toHaveValue("forever"));
        await user.selectOptions(version(), "");
        expect(api.saveAddonCenter).toHaveBeenLastCalledWith({ versionId: "" });
    });

    it("says \"from the category\" while no channel is picked", async () => {
        renderPage(<AddonCenterCard />);
        expect(await screen.findByRole("option", { name: t("addon.center.versionAutoNoChannel") })).toBeInTheDocument();
    });

    it("posts the centre and then shows when, the last check, a link to it, post again and remove", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getAddonCenter).mockResolvedValue(view({ settings: { channelId: "c1", versionId: "" } }));
        renderPage(<AddonCenterCard />);
        await user.click(await screen.findByRole("button", { name: t("addon.center.post") }));
        expect(api.postAddonCenter).toHaveBeenCalled();
        expect(await screen.findByText(t("addon.center.posted"))).toBeInTheDocument();
        expect(screen.getByRole("button", { name: t("addon.center.repost") })).toBeEnabled();
        expect(screen.getByText(/^gepostet .* · zuletzt geprüft /)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: t("addon.center.view") })).toHaveAttribute("href", "https://discord.com/channels/g1/c1/m1");
    });

    it("removes the centre after asking", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getAddonCenter).mockResolvedValue(posted());
        renderPage(<AddonCenterCard />);
        await user.click(await screen.findByRole("button", { name: t("common.remove") }));
        expect(await screen.findByText(t("addon.center.removeAsk"))).toBeInTheDocument();
        await user.click(screen.getAllByRole("button", { name: t("common.remove") }).at(-1)!);
        expect(api.removeAddonCenter).toHaveBeenCalled();
        expect(await screen.findByText(t("addon.center.removed"))).toBeInTheDocument();
        expect(screen.getByRole("button", { name: t("addon.center.post") })).toBeInTheDocument();
    });

    it("names a refusal and a failed move, and says when the bot is offline", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getAddonCenter).mockResolvedValue(posted({ online: false, checkedAt: 0 }));
        vi.mocked(api.saveAddonCenter).mockResolvedValueOnce({ ...posted(), warning: "Die Downloadzentrale konnte nicht gepostet werden: Missing Access" });
        renderPage(<AddonCenterCard />);
        expect(await screen.findByText(t("addon.center.offline"))).toBeInTheDocument();
        expect(screen.getByText(/noch nicht geprüft/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: t("addon.center.repost") })).toBeDisabled();
        await user.selectOptions(channel(), "c2");
        expect(await screen.findByText(/Missing Access/)).toBeInTheDocument();
        vi.mocked(api.saveAddonCenter).mockRejectedValueOnce({ message: "Ungültige Spielversion." });
        await user.selectOptions(version(), "tbc");
        expect(await screen.findByText("Ungültige Spielversion.")).toBeInTheDocument();
    });

    it("warns when the chosen role carries rights: pinged, but no 'Updates abonnieren'", async () => {
        vi.mocked(api.getAddonCenter).mockResolvedValue(posted({ roles: { g1: [{ id: "r1", name: "Gilde", privileged: true }, { id: "r3", name: "Addon-Updates" }] } }));
        renderPage(<AddonCenterCard />);
        expect(await screen.findByRole("alert")).toHaveTextContent(t("addon.center.rolePrivileged"));
    });

    it("shows no warning for a role without rights or without a role", async () => {
        vi.mocked(api.getAddonCenter).mockResolvedValue(posted({ roles: { g1: [{ id: "r1", name: "Addon-Updates", privileged: false }, { id: "r2", name: "Gilde", privileged: true }] } }));
        renderPage(<AddonCenterCard />);
        await screen.findByRole("heading", { name: t("addon.center.title") });
        expect(screen.queryByText(t("addon.center.rolePrivileged"))).toBeNull();
    });

    it("says when its settings cannot be loaded", async () => {
        vi.mocked(api.getAddonCenter).mockRejectedValue({ message: "403" });
        renderPage(<AddonCenterCard />);
        expect(await screen.findByText(t("addon.center.loadError"))).toBeInTheDocument();
    });
});

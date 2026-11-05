// One raid behind a signup link (#1074): the dialog of that raid and nothing else,
// through its own routes. What the routes answer is tested end to end in
// test/web/http/guildChoice.session.test.js.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { t } from "../../i18n";
import { statusBadgeLabel } from "../../lib/signups/status";
import { renderPage } from "../../test/render";
import { counts, ownRow, raidHelperRow, signup, signupsData } from "../../test/signupFixtures";
import SignupRaidPage from "../SignupRaidPage";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getSignups: vi.fn(),
    getSignupRaid: vi.fn(),
    saveSignup: vi.fn(),
    saveSignupRaid: vi.fn(),
}));

const RAID = ownRow({ id: "eh-foreign", title: "Fremder Raid" });

function show(onClose?: () => void) {
    return renderPage(<SignupRaidPage eventId="eh-foreign" accountName="Zibbo" onClose={onClose} />, { route: "/signups?event=eh-foreign" });
}

beforeEach(() => {
    vi.mocked(api.getSignups).mockReset();
    vi.mocked(api.getSignupRaid).mockReset();
    vi.mocked(api.saveSignup).mockReset();
    vi.mocked(api.saveSignupRaid).mockReset();
    vi.mocked(api.saveSignupRaid).mockResolvedValue({ signup: signup(), counts: counts({ attending: 4 }) });
});

describe("SignupRaidPage", () => {
    it("shows a loader, then only that raid's dialog", async () => {
        vi.mocked(api.getSignupRaid).mockResolvedValue(signupsData({ events: [RAID] }));
        show();
        expect(screen.getByText(t("signups.page.loading"))).toBeInTheDocument();
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(/Fremder Raid/)).toBeInTheDocument();
        expect(api.getSignupRaid).toHaveBeenCalledWith("eh-foreign");
        // never the list of the active server
        expect(api.getSignups).not.toHaveBeenCalled();
    });

    it("saves through the raid's own route and then says what stands", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSignupRaid).mockResolvedValue(signupsData({ events: [RAID] }));
        show();
        const dialog = await screen.findByRole("dialog");
        await user.click(within(dialog).getByRole("button", { name: t("signups.signUp") }));

        await waitFor(() => expect(api.saveSignupRaid).toHaveBeenCalledWith(expect.objectContaining({ eventId: "eh-foreign" })));
        expect(api.saveSignup).not.toHaveBeenCalled();
        expect(await screen.findByText(t("signups.raidLink.yours", { status: statusBadgeLabel("signed") }))).toBeInTheDocument();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        // the dialog opens again from here, with the change wording
        await user.click(screen.getByRole("button", { name: t("signups.dialog.change") }));
        expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });

    it("stays on the page with a way back when the dialog is closed without saving", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSignupRaid).mockResolvedValue(signupsData({ events: [RAID] }));
        show();
        const dialog = await screen.findByRole("dialog");
        await user.click(within(dialog).getByRole("button", { name: t("common.close") }));

        expect(await screen.findByText(t("signups.raidLink.notSignedUp"))).toBeInTheDocument();
        expect(screen.getByRole("link", { name: t("shell.app.backHome") })).toHaveAttribute("href", "/");
        expect(screen.getByRole("link", { name: t("signups.dialog.publicPage") })).toHaveAttribute("href", "/e/eh-foreign");
        expect(screen.getByRole("button", { name: t("signups.signUp") })).toBeInTheDocument();
    });

    it("hands the way back to the list a member came from", async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        vi.mocked(api.getSignupRaid).mockResolvedValue(signupsData({ events: [RAID] }));
        show(onClose);
        const dialog = await screen.findByRole("dialog");
        await user.click(within(dialog).getByRole("button", { name: t("common.close") }));
        expect(onClose).toHaveBeenCalled();
    });

    it("explains a refused raid and leads back home instead of an empty page", async () => {
        vi.mocked(api.getSignupRaid).mockRejectedValue({ code: api.RAID_UNAVAILABLE, message: "raw" });
        show();
        expect(await screen.findByText(t("signups.raidLink.unavailable"))).toBeInTheDocument();
        expect(screen.getByRole("link", { name: t("shell.app.backHome") })).toHaveAttribute("href", "/");
        // the page's refusal names no raid and no public page it could have guessed
        expect(screen.queryByRole("link", { name: t("signups.dialog.publicPage") })).not.toBeInTheDocument();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("tells a failed request from a refusal", async () => {
        vi.mocked(api.getSignupRaid).mockRejectedValue({ code: "http_500", message: "kaputt" });
        show();
        expect(await screen.findByText(t("signups.page.loadError", { message: "kaputt" }))).toBeInTheDocument();
        expect(screen.getByRole("link", { name: t("shell.app.backHome") })).toBeInTheDocument();
    });

    it("treats an answer without an own raid like a refusal", async () => {
        vi.mocked(api.getSignupRaid).mockResolvedValue(signupsData({ events: [raidHelperRow()] }));
        show();
        expect(await screen.findByText(t("signups.raidLink.unavailable"))).toBeInTheDocument();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
});

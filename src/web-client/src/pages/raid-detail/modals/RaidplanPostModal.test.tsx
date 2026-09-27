// "Einteilungen posten" (#502): the raid plan's read link in the event channel —
// the dialog shows whether there is anything to post, whether it is out, and
// sends the optional message; posting again says "Nachricht aktualisieren".
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import type { RaidDetailData, RaidplanPostState } from "../../../api";
import { t } from "../../../i18n";
import { renderPage } from "../../../test/render";
import { raidDetail } from "../../../test/fixtures/raidDetail";
import type { RaidCtx } from "../meta";
import RaidplanPostModal from "./RaidplanPostModal";

vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
    postRaidplanLink: vi.fn(),
}));

const state = (over: Partial<RaidplanPostState> = {}): RaidplanPostState => ({
    filled: true, published: false, publicPath: "", channelId: "", messageId: "", message: "", postedAt: 0, ...over,
});

function ctx(raidplanPost: RaidplanPostState | null): RaidCtx {
    const data: RaidDetailData = raidDetail({ raidplanPost });
    return { data, eventId: data.event.id, onChanged: vi.fn(), openModal: vi.fn(), openPlayer: vi.fn() };
}

beforeEach(() => {
    vi.mocked(api.postRaidplanLink).mockResolvedValue({ message: "Einteilungen in den Kanal gepostet.", updated: false, url: "https://x/p/abc", published: true });
});

describe("RaidplanPostModal", () => {
    it("says an empty plan has nothing to post and offers no button", () => {
        renderPage(<RaidplanPostModal ctx={ctx(state({ filled: false }))} open onClose={vi.fn()} />);
        expect(screen.getByText(t("raidModals.raidplan.empty"))).toBeInTheDocument();
        expect(screen.getByText(t("raidModals.raidplan.emptyHint"))).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: t("raidModals.raidplan.post") })).not.toBeInTheDocument();
    });

    it("warns that a draft gets published, and posts with the message", async () => {
        const user = userEvent.setup();
        const c = ctx(state());
        renderPage(<RaidplanPostModal ctx={c} open onClose={vi.fn()} />);
        expect(screen.getByText(t("raidModals.raidplan.draft"))).toBeInTheDocument();
        expect(screen.getByText(t("raidModals.raidplan.draftHint"))).toBeInTheDocument();
        expect(screen.getByText(t("raidModals.shared.notPosted"))).toBeInTheDocument();
        expect(screen.getByText("in #kara-do-01-10")).toBeInTheDocument();
        await user.type(screen.getByLabelText(new RegExp(t("raidModals.shared.message"))), "Bitte lesen");
        await user.click(screen.getByRole("button", { name: t("raidModals.raidplan.post") }));
        expect(api.postRaidplanLink).toHaveBeenCalledWith({ event: c.eventId, message: "Bitte lesen" });
        expect(c.onChanged).toHaveBeenCalledWith("Einteilungen in den Kanal gepostet.");
    });

    it("once posted: the date, the read view, the posted message and an update instead of a second post", async () => {
        const user = userEvent.setup();
        const postedAt = Date.UTC(2026, 8, 27, 18, 0);
        const c = ctx(state({ published: true, publicPath: "/p/abcdefghijklmnopqr", channelId: "ch1", messageId: "m1", message: "Alt", postedAt }));
        renderPage(<RaidplanPostModal ctx={c} open onClose={vi.fn()} />);
        expect(screen.getByText(t("raidModals.raidplan.published"))).toBeInTheDocument();
        expect(screen.getByText(/^gepostet am 27\.09\.2026/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: t("raidModals.raidplan.open") })).toHaveAttribute("href", "/p/abcdefghijklmnopqr");
        expect(screen.getByRole("link", { name: t("raidModals.shared.openPosted") })).toHaveAttribute("href", expect.stringContaining("/ch1/m1"));
        expect(screen.getByDisplayValue("Alt")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: t("raidModals.shared.updateMessage") }));
        expect(api.postRaidplanLink).toHaveBeenCalledWith({ event: c.eventId, message: "Alt" });
    });

    it("shows the server's refusal and stays open", async () => {
        const user = userEvent.setup();
        vi.mocked(api.postRaidplanLink).mockRejectedValue({ code: "no_public_url", message: "PUBLIC_BASE_URL fehlt." });
        const c = ctx(state());
        renderPage(<RaidplanPostModal ctx={c} open onClose={vi.fn()} />);
        await user.click(screen.getByRole("button", { name: t("raidModals.raidplan.post") }));
        expect(await screen.findByText("PUBLIC_BASE_URL fehlt.")).toBeInTheDocument();
        expect(c.onChanged).not.toHaveBeenCalled();
    });
});

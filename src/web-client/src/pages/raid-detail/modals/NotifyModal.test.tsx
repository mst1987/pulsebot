// "Anmelde-Aufruf" (NotifyModal): posts a call from a template into the event
// channel of the raid's server (#894: no other target any more; #264), and says
// where to create a template when there is none (#435).
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import type { RaidDetailData } from "../../../api";
import { t } from "../../../i18n";
import { renderPage } from "../../../test/render";
import type { RaidCtx } from "../meta";
import NotifyModal from "./NotifyModal";

vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
    notifyRaid: vi.fn(),
}));

function ctx(over: Partial<RaidDetailData> = {}): RaidCtx {
    const data = {
        event: { id: "e1", title: "Karazhan", channelId: "c1", channelName: "kara-mittwoch" },
        notifyTemplates: [{ id: "tpl1", name: "Standard" }],
        roles: [{ id: "r1", name: "Raider" }, { id: "r2", name: "Trial" }],
        attendance: { responded: [], missing: [] },
        ...over,
    } as unknown as RaidDetailData;
    return { data, eventId: "e1", onChanged: vi.fn(), openModal: vi.fn(), openPlayer: vi.fn() };
}

function show(c: RaidCtx) {
    const onClose = vi.fn();
    renderPage(<NotifyModal ctx={c} open onClose={onClose} />);
    return onClose;
}

beforeEach(() => {
    vi.mocked(api.notifyRaid).mockResolvedValue({ message: "Aufruf gepostet." });
});

describe("NotifyModal", () => {
    it("sends template and roles into the event channel, without a target", async () => {
        const user = userEvent.setup();
        const c = ctx();
        const onClose = show(c);
        expect(screen.getByText("in #kara-mittwoch")).toBeInTheDocument();
        expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();

        await user.click(screen.getByRole("checkbox", { name: "@Raider" }));
        await user.click(screen.getByRole("button", { name: t("raidModals.notify.post") }));

        await waitFor(() => expect(api.notifyRaid).toHaveBeenCalledWith({
            event: "e1", templateId: "tpl1", channelId: "c1", roleIds: ["r1"],
        }));
        await waitFor(() => expect(c.onChanged).toHaveBeenCalledWith("Aufruf gepostet."));
        expect(onClose).toHaveBeenCalled();
    });

    it("posts without roles too", async () => {
        const user = userEvent.setup();
        show(ctx());
        await user.click(screen.getByRole("button", { name: t("raidModals.notify.post") }));
        await waitFor(() => expect(api.notifyRaid).toHaveBeenCalledWith({
            event: "e1", templateId: "tpl1", channelId: "c1", roleIds: [],
        }));
    });

    it("keeps the call-template link sentence whole in German", () => {
        show(ctx({ notifyTemplates: [] }));
        const sentence = screen.getByText((_, el) => el?.tagName === "P"
            && el.textContent === "Noch keine Aufruf-Vorlagen. Lege zuerst unter Aufruf-Vorlagen eine an.");
        expect(sentence).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Aufruf-Vorlagen" })).toHaveAttribute("href", "/raids/templates");
        // nothing to post without a template
        expect(screen.queryByRole("button", { name: t("raidModals.notify.post") })).not.toBeInTheDocument();
    });
});

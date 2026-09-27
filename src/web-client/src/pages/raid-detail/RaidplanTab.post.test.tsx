// The raid plan tab's "Einteilungen posten" button (#502): beside "Freigeben &
// teilen" in the tool bar, only with raids write; it opens the page's dialog
// (after reading the page's data again), and a post that published the plan
// turns the tab's badge to "Freigegeben" without a reload of the plan.
import { useMemo, useState } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import type { Besetzung, RaidDetailData, RaidplanBoss, RaidplanPostState, RaidplanView } from "../../api";
import { t } from "../../i18n";
import { renderPage } from "../../test/render";
import { raidDetail } from "../../test/fixtures/raidDetail";
import type { RaidCtx } from "./meta";
import RaidplanTab from "./RaidplanTab";

vi.mock("../../api/client", async (orig) => ({ ...(await orig<typeof import("../../api/client")>()), get: vi.fn(), send: vi.fn() }));

const BOSS: RaidplanBoss = {
    key: "kara/attumen", instanceId: "kara", instanceName: "Karazhan", name: "Attumen", iconUrl: "", mapUrl: "",
    mapSource: "", ownMap: false, instanceMap: false,
};
const BES: Besetzung = { size: 10, counts: { tank: 2, healer: 3, dps: 5, melee: 2, ranged: 3 }, groups: 2, split: false };

function view(canWrite: boolean): RaidplanView {
    return {
        eventId: "own1", event: { id: "own1", title: "Karazhan", startTime: 0 }, canWrite,
        plan: { version: 1, status: "draft", publicPath: "", templateId: "", templateName: "", bosses: {}, updatedAt: 0 },
        bosses: [BOSS], besetzung: BES, catalog: null as unknown as RaidplanView["catalog"], roster: [], hasApprovedSetup: true,
        profiles: [], templates: [],
        limits: { tokensPerBoss: 60, targetsPerBoss: 10, usersPerTarget: 5, title: 60, notes: 500, mapBytes: 1, profileName: 40, profileCategory: 40 },
    };
}

function ctx(raidplanPost: RaidplanPostState | null = null): RaidCtx {
    const data: RaidDetailData = raidDetail({ raidplanPost });
    return { data, eventId: "own1", onChanged: vi.fn(), openModal: vi.fn(), openPlayer: vi.fn() };
}

/** jsdom has no ResizeObserver; the board only measures itself with it. */
class NoResize {
    observe() { /* nothing to measure in jsdom */ }
    unobserve() { /* nothing to measure in jsdom */ }
    disconnect() { /* nothing to measure in jsdom */ }
}

let current: RaidplanView;
beforeEach(() => {
    vi.stubGlobal("ResizeObserver", NoResize);
    current = view(true);
    vi.mocked(client.get).mockImplementation((path: string) => (path.startsWith("/api/raidplan?")
        ? Promise.resolve(current)
        : Promise.reject({ code: "not_mocked", message: path })));
});

const postButton = () => screen.queryByRole("button", { name: t("raidBoard.bar.postLink") });

describe("RaidplanTab: Einteilungen posten", () => {
    it("sits beside the share button and opens the page's dialog", async () => {
        const user = userEvent.setup();
        const c = ctx();
        renderPage(<RaidplanTab ctx={c} />);
        await screen.findByRole("button", { name: t("raidBoard.bar.share") });
        expect(postButton()).toHaveAttribute("data-tip-sub", t("raidBoard.bar.postLinkSub"));
        await user.click(postButton()!);
        expect(c.onChanged).toHaveBeenCalledWith("");
        expect(c.openModal).toHaveBeenCalledWith("raidplan");
    });

    it("is not there for a reader", async () => {
        current = view(false);
        renderPage(<RaidplanTab ctx={ctx()} />);
        await screen.findByText(t("raidBoard.bar.readOnly"));
        expect(postButton()).not.toBeInTheDocument();
    });

    it("takes over the publication a post made", async () => {
        const user = userEvent.setup();
        const posted: RaidplanPostState = { filled: true, published: true, publicPath: "/p/abcdefghijklmnopqr", channelId: "ch1", messageId: "m1", message: "", postedAt: 1 };
        /** The page after the post: its data read again, the tab still mounted. */
        function Page() {
            const [rp, setRp] = useState<RaidplanPostState | null>(null);
            const c = useMemo(() => ctx(rp), [rp]);
            return (
                <>
                    <button type="button" onClick={() => setRp(posted)}>reload</button>
                    <RaidplanTab ctx={c} />
                </>
            );
        }
        renderPage(<Page />);
        expect(await screen.findByText(t("raidBoard.bar.draft"))).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "reload" }));
        expect(await screen.findByText(t("raidBoard.bar.published"))).toBeInTheDocument();
    });
});

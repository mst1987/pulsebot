// "Fehlende pingen" (PingModal): pings the raiders who have not reacted, in the
// event channel, on the talk server or both — one compact "Wohin" segment that
// only appears with the talk server's ping channel (#264; #435: formerly scans
// in test/web-client/pingsRoleSync.test.js).
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import type { AttendancePerson, PingTargetInfo, RaidDetailData } from "../../../api";
import { t } from "../../../i18n";
import { renderPage } from "../../../test/render";
import type { RaidCtx } from "../meta";
import PingModal from "./PingModal";

vi.mock("../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../api")>()),
    pingMissingRaiders: vi.fn(),
}));

const TALK: PingTargetInfo = { talk: true, talkGuildName: "Pulse Talk", talkChannelName: "pings" };
const person = (id: string): AttendancePerson => ({ id, displayName: id, profile: null });

function ctx(over: Partial<RaidDetailData> = {}): RaidCtx {
    const data = {
        event: { id: "e1", title: "Karazhan", channelId: "c1", channelName: "kara-mittwoch" },
        attendance: { responded: [], missing: [person("a"), person("b")] },
        ...over,
    } as unknown as RaidDetailData;
    return { data, eventId: "e1", onChanged: vi.fn(), openModal: vi.fn(), openPlayer: vi.fn() };
}

beforeEach(() => {
    vi.mocked(api.pingMissingRaiders).mockResolvedValue({ message: "2 gepingt." });
});

describe("PingModal", () => {
    it("is one compact segment, rendered only when the server offers the talk server", () => {
        renderPage(<PingModal ctx={ctx({ pingTargets: TALK })} open onClose={vi.fn()} />);
        const segment = screen.getByRole("radiogroup", { name: "Wohin" });
        expect(within(segment).getAllByRole("radio").map((r) => r.textContent)).toEqual([
            t("raidModals.target.event"), t("raidModals.target.talk"), t("raidModals.target.both"),
        ]);
        expect(within(segment).getByRole("radio", { name: t("raidModals.target.event") })).toHaveAttribute("aria-checked", "true");
        expect(within(segment).getByRole("radio", { name: t("raidModals.target.talk") }))
            .toHaveAttribute("data-tip", t("raidModals.target.talkTip", { where: "#pings", server: "Pulse Talk" }));
    });

    it("renders no segment without the talk server", () => {
        renderPage(<PingModal ctx={ctx()} open onClose={vi.fn()} />);
        expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
        expect(screen.getByText("in #kara-mittwoch")).toBeInTheDocument();
    });

    it("sends the target and the text, and says in the head where it goes", async () => {
        const user = userEvent.setup();
        const c = ctx({ pingTargets: TALK });
        renderPage(<PingModal ctx={c} open onClose={vi.fn()} />);

        await user.click(screen.getByRole("radio", { name: t("raidModals.target.talk") }));
        expect(screen.getByText("in #pings")).toBeInTheDocument();
        await user.type(screen.getByRole("textbox"), "Bitte reagieren");
        await user.click(screen.getByRole("button", { name: t("raidModals.ping.submit", { count: 2 }) }));

        await waitFor(() => expect(api.pingMissingRaiders).toHaveBeenCalledWith({ event: "e1", text: "Bitte reagieren", target: "talk" }));
        await waitFor(() => expect(c.onChanged).toHaveBeenCalledWith("2 gepingt."));
    });

    it("cannot ping when nobody is missing", () => {
        renderPage(<PingModal ctx={ctx({ attendance: { responded: [], missing: [] } })} open onClose={vi.fn()} />);
        expect(screen.getByRole("button", { name: t("raidModals.ping.submit", { count: 0 }) })).toBeDisabled();
    });
});

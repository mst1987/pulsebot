// "Fehlende pingen" (PingModal): pings the raiders who have not reacted in the
// event channel of the raid's server; whoever is not on that server gets a DM
// (#894: no "Wohin" segment any more; #264, #435).
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../../api";
import type { AttendancePerson, RaidDetailData } from "../../../../api";
import { t } from "../../../../i18n";
import { renderPage } from "../../../../test/render";
import type { RaidCtx } from "../../meta";
import PingModal from "../PingModal";

vi.mock("../../../../api", async (orig) => ({
    ...(await orig<typeof import("../../../../api")>()),
    pingMissingRaiders: vi.fn(),
}));

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
    it("has no target segment, names the raid channel and says who gets a DM", () => {
        renderPage(<PingModal ctx={ctx()} open onClose={vi.fn()} />);
        expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
        expect(screen.getByText("in #kara-mittwoch")).toBeInTheDocument();
        expect(screen.getByText(t("raidModals.ping.dmNote"))).toBeInTheDocument();
    });

    it("sends only the event and the text", async () => {
        const user = userEvent.setup();
        const c = ctx();
        renderPage(<PingModal ctx={c} open onClose={vi.fn()} />);

        await user.type(screen.getByRole("textbox"), "Bitte reagieren");
        await user.click(screen.getByRole("button", { name: t("raidModals.ping.submit", { count: 2 }) }));

        await waitFor(() => expect(api.pingMissingRaiders).toHaveBeenCalledWith({ event: "e1", text: "Bitte reagieren" }));
        await waitFor(() => expect(c.onChanged).toHaveBeenCalledWith("2 gepingt."));
    });

    it("cannot ping when nobody is missing", () => {
        renderPage(<PingModal ctx={ctx({ attendance: { responded: [], missing: [] } })} open onClose={vi.fn()} />);
        expect(screen.getByRole("button", { name: t("raidModals.ping.submit", { count: 0 }) })).toBeDisabled();
    });
});

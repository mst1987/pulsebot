// The voice channel API of the setup editor: which request each call sends.
// The transport (api/client) is mocked, nothing leaves the test.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../client";
import { closeVoice, getVoice, openVoice } from "../voice";

vi.mock("../../client", async (orig) => ({ ...(await orig<typeof import("../../client")>()), get: vi.fn(), send: vi.fn() }));

beforeEach(() => {
    vi.mocked(client.get).mockReset().mockResolvedValue({} as never);
    vi.mocked(client.send).mockReset().mockResolvedValue({} as never);
});

describe("voice api", () => {
    it("loads the group's channels with the event id encoded", async () => {
        await getVoice("ev 1");
        expect(client.get).toHaveBeenLastCalledWith("/api/raids/voice?event=ev%201");
    });

    it("opens and closes with POST and the event in the body", async () => {
        await openVoice("ev1");
        expect(client.send).toHaveBeenLastCalledWith("POST", "/api/raids/voice/open", { event: "ev1" });
        await closeVoice("ev1");
        expect(client.send).toHaveBeenLastCalledWith("POST", "/api/raids/voice/close", { event: "ev1" });
    });
});

// The Orga-Zentrale API: which request each call sends. The transport (api/client) is mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../client";
import { getOrgaHubs, postOrgaHub, removeOrgaHub, saveOrgaLinks } from "../orgaHub";

vi.mock("../../client", async (orig) => ({ ...(await orig<typeof import("../../client")>()), get: vi.fn(), send: vi.fn() }));

beforeEach(() => {
    vi.mocked(client.get).mockReset().mockResolvedValue({} as never);
    vi.mocked(client.send).mockReset().mockResolvedValue({} as never);
});

describe("orgaHub api", () => {
    it("lists, posts and removes the hubs", async () => {
        await getOrgaHubs();
        expect(client.get).toHaveBeenLastCalledWith("/api/orga-hubs");
        await postOrgaHub("c1", "ch1");
        expect(client.send).toHaveBeenLastCalledWith("POST", "/api/orga-hub", { categoryId: "c1", channelId: "ch1" });
        await removeOrgaHub("c1");
        expect(client.send).toHaveBeenLastCalledWith("DELETE", "/api/orga-hub", { categoryId: "c1" });
        await saveOrgaLinks("c1", [{ label: "WCL", url: "https://example.org" }]);
        expect(client.send).toHaveBeenLastCalledWith("PUT", "/api/orga-hub/links", { categoryId: "c1", links: [{ label: "WCL", url: "https://example.org" }] });
    });
});

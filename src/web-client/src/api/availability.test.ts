// The absence/attendance API: which request each call sends. The transport
// (api/client) is mocked, nothing leaves the test.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "./client";
import {
    deleteAvailability, getAvailability, getAvailabilityPanels, postAvailabilityPanel, previewAvailability,
    removeAvailabilityPanel, saveAvailability, saveAvailabilityLinks,
} from "./availability";

vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), get: vi.fn(), send: vi.fn() }));

beforeEach(() => {
    vi.mocked(client.get).mockReset().mockResolvedValue({} as never);
    vi.mocked(client.send).mockReset().mockResolvedValue({} as never);
});

describe("availability api", () => {
    it("loads the own entries, or a raider's for the orga with the id encoded", async () => {
        await getAvailability();
        expect(client.get).toHaveBeenLastCalledWith("/api/availability");
        await getAvailability("12 34");
        expect(client.get).toHaveBeenLastCalledWith("/api/availability?userId=12%2034");
    });

    it("previews and saves with POST, deletes with DELETE", async () => {
        const input = { kind: "absence" as const, from: "2026-10-05", to: "2026-10-09" };
        await previewAvailability(input);
        expect(client.send).toHaveBeenLastCalledWith("POST", "/api/availability/preview", input);
        const save = { ...input, comment: "Urlaub", eventIds: ["a"] };
        await saveAvailability(save);
        expect(client.send).toHaveBeenLastCalledWith("POST", "/api/availability", save);
        await deleteAvailability("av1");
        expect(client.send).toHaveBeenLastCalledWith("DELETE", "/api/availability", { id: "av1" });
    });

    it("lists, posts and removes the Discord panels", async () => {
        await getAvailabilityPanels();
        expect(client.get).toHaveBeenLastCalledWith("/api/availability/panels");
        await postAvailabilityPanel("c1", "ch1");
        expect(client.send).toHaveBeenLastCalledWith("POST", "/api/availability/panel", { categoryId: "c1", channelId: "ch1" });
        await removeAvailabilityPanel("c1");
        expect(client.send).toHaveBeenLastCalledWith("DELETE", "/api/availability/panel", { categoryId: "c1" });
    });

    it("replaces a category's organizer links with PUT", async () => {
        const links = [{ label: "WCL", url: "https://www.warcraftlogs.com/x" }];
        await saveAvailabilityLinks("c1", links);
        expect(client.send).toHaveBeenLastCalledWith("PUT", "/api/availability/links", { categoryId: "c1", links });
    });
});

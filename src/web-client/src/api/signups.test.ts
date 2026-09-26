// The signup API talks to the signup endpoints only (#256/#293): which request
// each call sends. The transport (api/client) is mocked, nothing leaves the test.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "./client";
import { getEventSignups, getSignups, saveSignup, saveSignupsBulk } from "./signups";

vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), get: vi.fn(), send: vi.fn() }));

beforeEach(() => {
    vi.mocked(client.get).mockReset().mockResolvedValue({} as never);
    vi.mocked(client.send).mockReset().mockResolvedValue({} as never);
});

describe("signups api", () => {
    it("loads the page's raids from /api/signups", async () => {
        await getSignups();
        expect(client.get).toHaveBeenCalledWith("/api/signups");
    });

    it("saves one signup with PUT /api/signups", async () => {
        const input = { eventId: "eh-kara", characters: [{ character: "Zibbo", spec: "Priest-Holy" }], status: "signed" as const, canAlso: [], comment: "" };
        await saveSignup(input);
        expect(client.send).toHaveBeenCalledWith("PUT", "/api/signups", input);
    });

    it("saves several raids at once with POST /api/signups/bulk", async () => {
        const input = { eventIds: ["a", "b"], characters: [{ character: "Zibbo", spec: "Priest-Holy" }], status: "signed" as const };
        await saveSignupsBulk(input);
        expect(client.send).toHaveBeenCalledWith("POST", "/api/signups/bulk", input);
    });

    it("loads one event's signups for the orga, the id encoded", async () => {
        await getEventSignups("eh kara");
        expect(client.get).toHaveBeenCalledWith("/api/signups/event?id=eh%20kara");
    });
});

// The signup API talks to the signup endpoints only (#256/#293): which request
// each call sends. The transport (api/client) is mocked, nothing leaves the test.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../client";
import { getSignupRaid, getSignups, saveSignup, saveSignupRaid, saveSignupsBulk } from "../signups";

vi.mock("../../client", async (orig) => ({ ...(await orig<typeof import("../../client")>()), get: vi.fn(), send: vi.fn() }));

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

    it("asks for the one raid of a link through its own route, the id encoded (#1074)", async () => {
        await getSignupRaid("eh kara");
        expect(client.get).toHaveBeenCalledWith("/api/signups/raid?event=eh%20kara");
    });

    it("saves the signup of a raid link with PUT /api/signups/raid (#1074)", async () => {
        const input = { eventId: "eh-kara", characters: [{ character: "Zibbo", spec: "Priest-Holy" }], status: "signed" as const, canAlso: [], comment: "" };
        await saveSignupRaid(input);
        expect(client.send).toHaveBeenCalledWith("PUT", "/api/signups/raid", input);
    });

    it("saves several raids at once with POST /api/signups/bulk", async () => {
        const input = { eventIds: ["a", "b"], characters: [{ character: "Zibbo", spec: "Priest-Holy" }], status: "signed" as const };
        await saveSignupsBulk(input);
        expect(client.send).toHaveBeenCalledWith("POST", "/api/signups/bulk", input);
    });
});

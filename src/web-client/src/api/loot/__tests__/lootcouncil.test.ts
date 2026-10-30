// The council's armory calls carry the view's scope (#923): the server reads
// the armory of the realm that belongs to the view's version. ../../client is mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { get, send } from "../../client";
import { getCouncilExport, refreshCouncilArmory } from "../lootcouncil";

vi.mock("../../client", async (orig) => ({
    ...(await orig<typeof import("../../client")>()),
    get: vi.fn(),
    send: vi.fn(),
}));

beforeEach(() => {
    vi.mocked(get).mockResolvedValue({});
    vi.mocked(send).mockResolvedValue({});
});

describe("api/loot/lootcouncil.ts armory scope", () => {
    it("sends the view's roster, category and version with the armory refresh", async () => {
        await refreshCouncilArmory(["Alpha"], { roster: "r1", category: "c1", version: "classic" });
        await refreshCouncilArmory(["Beta"]);
        expect(vi.mocked(send).mock.calls).toEqual([
            ["POST", "/api/lootcouncil/armory", { characters: ["Alpha"], roster: "r1", category: "c1", version: "classic" }],
            ["POST", "/api/lootcouncil/armory", { characters: ["Beta"] }],
        ]);
    });

    it("asks for the export with the scope in the query and leaves empty parts out", async () => {
        await getCouncilExport("Al pha", { roster: "", category: "c1", version: "classic" });
        await getCouncilExport("Beta");
        expect(vi.mocked(get).mock.calls.map((c) => c[0])).toEqual([
            "/api/lootcouncil/export?character=Al+pha&category=c1&version=classic",
            "/api/lootcouncil/export?character=Beta",
        ]);
    });
});

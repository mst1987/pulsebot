// The client's second loot filter (#919): rows of another Discord server never show.
import { describe, expect, it } from "vitest";
import { ofServer } from "./ofServer";

describe("ofServer", () => {
    const rows = [{ id: "a", guildId: "gA" }, { id: "b", guildId: "gB" }, { id: "old" }, { id: "blank", guildId: "" }];

    it("keeps the active server's rows and rows without a server", () => {
        expect(ofServer(rows, "gA").map((r) => r.id)).toEqual(["a", "old", "blank"]);
        expect(ofServer(rows, "gB").map((r) => r.id)).toEqual(["b", "old", "blank"]);
    });

    it("drops every server-bound row without an active server", () => {
        expect(ofServer(rows, "").map((r) => r.id)).toEqual(["old", "blank"]);
        expect(ofServer(rows, undefined).map((r) => r.id)).toEqual(["old", "blank"]);
    });
});

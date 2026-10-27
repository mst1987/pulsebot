// The server pick of System › Discord (#895): the server from ?guild=, the old
// ?side=talk link onto the second server, the first server as the default
// without a URL parameter, and how a server is named in the picker.
import { describe, expect, it } from "vitest";
import type { DiscordServerChoice } from "../../api";
import { guildParam, pickedGuild, serverExtra, serverName, shortName } from "./serverPick";

const S = (guildId: string, name = "", label = ""): DiscordServerChoice => ({ guildId, name, label, online: true, iconUrl: "" });
const LIST = [S("g1", "Testgilde"), S("g2", "Talkgilde", "Talk"), S("g3", "Dritte")];

describe("pickedGuild", () => {
    it("takes a known server from the URL", () => {
        expect(pickedGuild(LIST, "g3", null)).toBe("g3");
    });

    it("falls back to the first server for an unknown or missing one", () => {
        expect(pickedGuild(LIST, "nope", null)).toBe("g1");
        expect(pickedGuild(LIST, null, null)).toBe("g1");
    });

    it("opens the second server from an old talk link, guild wins over side", () => {
        expect(pickedGuild(LIST, null, "talk")).toBe("g2");
        expect(pickedGuild(LIST, "g3", "talk")).toBe("g3");
        expect(pickedGuild([LIST[0]], null, "talk")).toBe("g1");
        expect(pickedGuild(LIST, null, "event")).toBe("g1");
    });

    it("is empty without a server list", () => {
        expect(pickedGuild([], "g1", "talk")).toBe("");
    });
});

describe("guildParam", () => {
    it("needs no parameter for the first server", () => {
        expect(guildParam(LIST, "g1")).toEqual({});
        expect(guildParam(LIST, "")).toEqual({});
        expect(guildParam(null, "g2")).toEqual({});
        expect(guildParam([], "g2")).toEqual({});
    });

    it("names any other server", () => {
        expect(guildParam(LIST, "g2")).toEqual({ guild: "g2" });
    });
});

describe("naming", () => {
    it("names a server by Discord name, else label, else id", () => {
        expect(serverName(S("g1", "Testgilde", "Raid"))).toBe("Testgilde");
        expect(serverName(S("g1", "", "Raid"))).toBe("Raid");
        expect(serverName(S("g1"))).toBe("g1");
    });

    it("adds the label only where it says something new", () => {
        expect(serverExtra(S("g2", "Talkgilde", "Talk"))).toBe("Talk");
        expect(serverExtra(S("g2", "Talk", "Talk"))).toBe("");
        expect(serverExtra(S("g2", "", "Talk"))).toBe("");
        expect(serverExtra(S("g2", "Talkgilde"))).toBe("");
    });

    it("cuts long names with an ellipsis", () => {
        expect(shortName("Kurz")).toBe("Kurz");
        expect(shortName("Ein sehr langer Servername mit Zusatz")).toBe("Ein sehr langer Serve…");
        // no space left before the ellipsis
        expect(shortName("Ein sehr langer Servername", 10)).toBe("Ein sehr…");
    });
});

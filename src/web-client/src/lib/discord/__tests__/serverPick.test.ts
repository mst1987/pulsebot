// How a server of the server list is named where a page offers it (#895).
import { describe, expect, it } from "vitest";
import type { DiscordServerChoice } from "../../../api";
import { serverExtra, serverName, shortName } from "../serverPick";

const S = (guildId: string, name = "", label = ""): DiscordServerChoice => ({ guildId, name, label, online: true, iconUrl: "" });

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

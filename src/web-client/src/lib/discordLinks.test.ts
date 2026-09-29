// The web client's Discord links (#537): the post of an event is linked only
// while the server says its channel exists (channelState from linkCheck.js).
import { describe, expect, it } from "vitest";
import { channelLinkable, eventPostUrl, messageLink, raidplanUrl } from "./discordLinks";

describe("lib/discordLinks", () => {
    it("links an own event's channel and a Raid-Helper event's post", () => {
        expect(eventPostUrl("g1", "c1", "eh-1")).toBe("https://discord.com/channels/g1/c1");
        expect(eventPostUrl("g1", "c1", "1400", "ok")).toBe("https://discord.com/channels/g1/c1/1400");
    });

    it("gives no link for a missing or unknown channel, or without ids", () => {
        expect(eventPostUrl("g1", "c1", "eh-1", "missing")).toBe("");
        expect(eventPostUrl("g1", "c1", "eh-1", "unknown")).toBe("");
        expect(eventPostUrl("", "c1", "eh-1")).toBe("");
        expect(eventPostUrl("g1", "", "eh-1")).toBe("");
    });

    it("counts an answer without a state as linkable", () => {
        expect(channelLinkable(undefined)).toBe(true);
        expect(channelLinkable("ok")).toBe(true);
        expect(channelLinkable("missing")).toBe(false);
    });

    it("builds message and raidplan links", () => {
        expect(messageLink("g1", "c1", "m1")).toBe("https://discord.com/channels/g1/c1/m1");
        expect(raidplanUrl("eh-1")).toBe("");
        expect(raidplanUrl("1400")).toBe("https://raid-helper.xyz/raidplan/1400");
    });
});

// The client's copy of the server's link check for a recruitment post's link button.
import { describe, expect, it } from "vitest";
import { isDiscordInviteUrl } from "./inviteLink";

describe("isDiscordInviteUrl", () => {
    it("takes Discord invites and channel links", () => {
        expect(isDiscordInviteUrl("https://discord.gg/abc123")).toBe(true);
        expect(isDiscordInviteUrl(" https://discord.com/invite/Partner-Gilde/ ")).toBe(true);
        expect(isDiscordInviteUrl("https://www.discord.com/invite/abc")).toBe(true);
        expect(isDiscordInviteUrl("https://discord.com/channels/1139509316387344395")).toBe(true);
        expect(isDiscordInviteUrl("https://discord.com/channels/1139509316387344395/1139509316387344396/1139509316387344397")).toBe(true);
    });

    it("takes an upper-case scheme and host like the server", () => {
        expect(isDiscordInviteUrl("HTTPS://Discord.GG/AbC123")).toBe(true);
        expect(isDiscordInviteUrl("https://WWW.DISCORD.COM/invite/abc")).toBe(true);
        expect(isDiscordInviteUrl("HTTPS://DISCORD.GG.EVIL.EXAMPLE/abc")).toBe(false);
    });

    it("refuses everything else", () => {
        for (const bad of [
            "", "   ", "discord.gg/abc", "http://discord.gg/abc", "https://discord.gg/a", "https://discord.gg/abc?x=1",
            "https://evil.example/discord.gg/abc", "https://discord.com/invite/", "https://discord.com/channels/abc",
            "https://discord.com/channels/123456/123456/123456/123456", "javascript:alert(1)", `https://discord.gg/${"a".repeat(600)}`,
        ]) expect(isDiscordInviteUrl(bad)).toBe(false);
    });
});

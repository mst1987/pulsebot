// A recruitment link button may only lead into Discord: an invite (discord.gg, discord.com/invite) or a channel link.
const { cleanInviteUrl, isDiscordInviteUrl } = require("../../../src/utils/recruitment/inviteLink");

describe("utils/recruitment/inviteLink", () => {
    it.each([
        "https://discord.gg/abc123",
        "https://discord.gg/Pulse-Raid/",
        "https://discord.com/invite/abc123",
        "https://www.discord.com/invite/abc123",
        "https://discord.com/channels/113950931638734439",
        "https://discord.com/channels/113950931638734439/113950931638734440",
        "https://discord.com/channels/113950931638734439/113950931638734440/113950931638734441",
    ])("takes %s", (url) => {
        expect(isDiscordInviteUrl(url)).toBe(true);
        expect(cleanInviteUrl(`  ${url}  `)).toBe(url);
    });

    it.each([
        "",
        "discord.gg/abc",
        "http://discord.gg/abc",
        "https://evil.example/discord.gg/abc",
        "https://discord.gg.evil.example/abc",
        "https://discord.gg/abc?x=<script>",
        "https://discord.com/channels/@me/123456",
        "javascript:alert(1)",
        "https://discord.gg/" + "a".repeat(600),
    ])("refuses %s", (url) => {
        expect(isDiscordInviteUrl(url)).toBe(false);
        expect(cleanInviteUrl(url)).toBe("");
    });

    it("refuses non-strings", () => {
        expect(cleanInviteUrl(undefined)).toBe("");
        expect(cleanInviteUrl(null)).toBe("");
        expect(cleanInviteUrl(42)).toBe("");
    });
});

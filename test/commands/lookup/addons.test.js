// /addons (#818): an ephemeral card of the guild's addons for the command's
// game version, with a link to the web page — never to a file.
jest.mock("../../../src/stores/configStore", () => ({ getConfig: () => mockConfig }));
jest.mock("../../../src/classes/githubReleases", () => ({ fetchLatestRelease: jest.fn() }));

let mockConfig = null;

const { MessageFlags } = require("discord.js");
const addons = require("../../../src/commands/lookup/addons");
const { fetchLatestRelease } = require("../../../src/classes/githubReleases");
const { resetAddonReleaseCache } = require("../../../src/services/addons/addonReleases");
const { defaultAddons } = require("../../../src/services/addons/addonConfig");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { memberMayRun } = require("../../helpers/botCommandAccess");

const release = (version) => ({ version, tag: `v${version}`, name: "", publishedAt: "2026-10-12T10:00:00Z", notes: "", assets: [] });

beforeEach(() => {
    jest.clearAllMocks();
    resetAddonReleaseCache();
    mockConfig = { addonDownloads: defaultAddons(), github: { token: "t" }, mainVersion: "forever" };
    fetchLatestRelease.mockImplementation(async ({ repo }) => {
        if (repo === "mst1987/professionkit") throw Object.assign(new Error("none"), { code: "no_release" });
        return release(repo === "mst1987/levelhelper" ? "0.3.0" : "1.14.0");
    });
});

describe("/addons", () => {
    it("is open to every member and has a slash definition with the version choice", () => {
        expect(memberMayRun(addons)).toBe(true);
        const data = addons.data.toJSON();
        expect(data.name).toBe("addons");
        expect(data.options.map((o) => o.name)).toEqual(["version"]);
    });

    it("answers only the asker with a card of the version's addons and a link to the page", async () => {
        const interaction = mockInteraction({ commandName: "addons" });
        await addons.execute(interaction);
        expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
        const payload = interaction.editReply.mock.calls[0][0];
        const embed = payload.embeds[0];
        expect(embed.title).toBe("Addons der Gilde");
        expect(embed.description).toContain("**LevelHelper** · v0.3.0 · <t:");
        expect(embed.description).toContain("**ProfessionKit** · noch kein Release");
        expect(embed.description).toContain("**EventHelper Sync** · v1.14.0");
        expect(embed.footer.text).toBe("Version: WoW Forever");
        const buttons = payload.components[0].components;
        expect(buttons).toHaveLength(1);
        expect(buttons[0]).toMatchObject({ style: 5, label: "Zur Download-Seite" });
        expect(buttons[0].url).toMatch(/\/addon$/);
        expect(JSON.stringify(payload)).not.toMatch(/github|download\?/i);
    });

    it("follows the picked version", async () => {
        const interaction = mockInteraction({ commandName: "addons", options: { version: "tbc" } });
        await addons.execute(interaction);
        const embed = interaction.editReply.mock.calls[0][0].embeds[0];
        expect(embed.description).toContain("EventHelper Sync");
        expect(embed.description).not.toContain("LevelHelper");
    });
});

describe("addonsCard", () => {
    const addon = defaultAddons()[0];

    it("says an addon is not available without the token or when GitHub fails", () => {
        const { embed } = addonsCardOf([{ addon, result: { state: "token_missing", release: null } }]);
        expect(embed.description).toContain("**LevelHelper** · gerade nicht verfügbar");
    });

    it("says so when the version has no addons", () => {
        const { embed, link } = addonsCardOf([]);
        expect(embed.description).toBe("Für diese Version gibt es keine Addons zum Herunterladen.");
        expect(link[0].url).toMatch(/\/addon$/);
    });

    function addonsCardOf(entries) {
        return addons.addonsCard(entries, "forever");
    }
});

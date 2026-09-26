// /recruitment: posts a recruitment template from the admin menu into a channel
// and remembers the post so the menu can edit it later.
jest.mock("../../../src/web/recruitmentStore", () => ({
    listRecruitment: jest.fn(() => []),
    saveRecruitmentPost: jest.fn(),
}));

const { MessageFlags } = require("discord.js");
const { listRecruitment, saveRecruitmentPost } = require("../../../src/web/recruitmentStore");
const { embedAccentColor } = require("../../../src/config/variables");
const recruitment = require("../../../src/commands/apply/recruitment");
const { mockInteraction } = require("../../helpers/mockInteraction");

function targetChannel(over = {}) {
    return {
        id: "chan-9",
        guildId: "guild-1",
        name: "recruitment",
        toString: () => "<#chan-9>",
        send: jest.fn(async () => ({ id: "msg-1", url: "https://discord.com/channels/guild-1/chan-9/msg-1" })),
        ...over,
    };
}

async function run(vorlage, channel = targetChannel()) {
    const interaction = mockInteraction({ commandName: "recruitment", options: { vorlage, channel } });
    await recruitment.execute(interaction);
    return { interaction, channel };
}

const TEMPLATES = [
    { name: "Healer", title: "Wir suchen Heiler", body: "Bewirb dich!", buttonLabel: "Heiler werden" },
    { name: "Plain", title: "", body: "Nur Text" },
    { name: "Empty", title: "", body: "" },
];

beforeEach(() => {
    jest.clearAllMocks();
    listRecruitment.mockReturnValue(TEMPLATES);
});

describe("/recruitment", () => {
    it("is an admin command with the two required options", () => {
        expect(recruitment.name).toBe("recruitment");
        expect(recruitment.defaultAccess).toBe("admins");
        expect(recruitment.group).toBe("recruitment");
        const json = recruitment.data.toJSON();
        expect(json.options.map((o) => [o.name, o.required])).toEqual([["vorlage", true], ["channel", true]]);
    });

    it("says so when no template exists yet", async () => {
        listRecruitment.mockReturnValue([]);
        const { interaction, channel } = await run("Healer");
        expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining("noch keine Recruitment-Vorlagen"));
        expect(channel.send).not.toHaveBeenCalled();
    });

    it("lists the available templates for an unknown name", async () => {
        const { interaction, channel } = await run("Tank");
        const text = interaction.editReply.mock.calls[0][0];
        expect(text).toContain("„Tank\"");
        expect(text).toContain("Verfügbare Vorlagen:\n• Healer\n• Plain\n• Empty");
        expect(channel.send).not.toHaveBeenCalled();
    });

    it("refuses a template with neither title nor body", async () => {
        const { interaction, channel } = await run("empty");
        expect(interaction.editReply).toHaveBeenCalledWith("Diese Vorlage hat weder Titel noch Text — bitte im Admin-Menü ausfüllen.");
        expect(channel.send).not.toHaveBeenCalled();
    });

    it("posts the embed with the apply button (name matched case-insensitively) and saves the post", async () => {
        const { interaction, channel } = await run("HEALER");
        expect(channel.send).toHaveBeenCalledTimes(1);
        const sent = channel.send.mock.calls[0][0];
        expect(sent.embeds[0].toJSON()).toMatchObject({ title: "Wir suchen Heiler", description: "Bewirb dich!", color: embedAccentColor });
        expect(sent.components[0].toJSON().components[0]).toMatchObject({ custom_id: "apply", label: "Heiler werden" });
        expect(saveRecruitmentPost).toHaveBeenCalledWith({
            guildId: "guild-1",
            channelId: "chan-9",
            messageId: "msg-1",
            channelName: "recruitment",
            title: "Wir suchen Heiler",
            body: "Bewirb dich!",
            buttonLabel: "Heiler werden",
            source: "command",
        });
        expect(interaction.editReply).toHaveBeenCalledWith(
            "Recruitment-Nachricht „Healer\" gepostet in <#chan-9>: https://discord.com/channels/guild-1/chan-9/msg-1"
        );
    });

    it("leaves the title out when the template has none and uses the default button label", async () => {
        const { channel } = await run("Plain");
        const sent = channel.send.mock.calls[0][0];
        const embed = sent.embeds[0].toJSON();
        expect(embed.title).toBeUndefined();
        expect(embed.description).toBe("Nur Text");
        expect(sent.components[0].toJSON().components[0].label).toBe("Jetzt bewerben");
    });

    it("answers a failed post instead of throwing and saves nothing", async () => {
        const channel = targetChannel({ send: jest.fn(async () => { throw new Error("Missing Permissions"); }) });
        const { interaction } = await run("Healer", channel);
        expect(saveRecruitmentPost).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith(
            "Konnte die Nachricht nicht im Ziel-Channel posten (fehlende Berechtigungen oder kein Textkanal?)."
        );
    });
});

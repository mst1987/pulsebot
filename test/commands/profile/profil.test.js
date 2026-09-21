// /profil: kurze Zusammenfassung des eigenen Profils, Link ins Web und die
// Schnell-Schalter "kann Offtank" / "kann heilen".
const { MessageFlags } = require("discord.js");
const store = require("../../../src/web/raiderProfileStore");
const command = require("../../../src/commands/profile/profil");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { tempStoreFile } = require("../../helpers/tempStore");

const USER = "300000000000000001";

beforeAll(() => store.useFile(tempStoreFile("eh-profiles-cmd.json")));
afterEach(() => store.reset());
afterAll(() => store.useFile(null));

function embedText(arg) {
    return arg.embeds[0].data.description;
}

describe("commands/profile/profil", () => {
    it("heißt profil und antwortet nur dem Aufrufer", async () => {
        expect(command.name).toBe("profil");
        const interaction = mockInteraction({ userId: USER, commandName: "profil" });
        await command.execute(interaction);
        const arg = interaction.reply.mock.calls[0][0];
        expect(arg.flags).toBe(MessageFlags.Ephemeral);
        expect(embedText(arg)).toContain("No character yet");
        const [tank, heal, link] = arg.components[0].components.map((c) => c.data);
        expect(tank.custom_id).toBe("profil:tank");
        expect(heal.custom_id).toBe("profil:heal");
        expect(link.url).toMatch(/\/profile$/);
    });

    it("fasst Charaktere, Specs mit Gear-Stand und Tage zusammen", () => {
        store.addCharacter(USER, { name: "Nerathil", className: "Mage", specs: [{ key: "Mage-Arcane", gear: "ready" }] });
        const profile = store.saveProfile(USER, { availability: ["mi", "so"] });
        const text = command.summaryLines(profile).join("\n");
        expect(text).toContain("**Nerathil** · Main — Arcane (raid ready)");
        expect(text).toContain("Off-tank: no · Heal: no");
        expect(text).toContain("Available: Wed · Sun");
    });

    it("schaltet per Button um und speichert es im eigenen Profil", async () => {
        store.addCharacter(USER, { name: "Bärbel", className: "Druid", specs: ["Druid-Guardian"] });
        const interaction = mockInteraction({ userId: USER, customId: "profil:tank" });
        await command.execute(interaction);
        // vorgeschlagen war "kann Offtank" (Bär), der Klick schaltet es aus
        expect(store.getProfile(USER).canOfftank).toBe(false);
        expect(embedText(interaction.update.mock.calls[0][0])).toContain("Off-tank: no");

        await command.execute(mockInteraction({ userId: USER, customId: "profil:heal" }));
        expect(store.getProfile(USER).canHeal).toBe(true);
    });
});

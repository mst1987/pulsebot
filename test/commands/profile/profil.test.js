// /profil: kurze Zusammenfassung des eigenen Profils, Link ins Web und die
// Schnell-Schalter "kann Offtank" / "kann heilen".
const { MessageFlags } = require("discord.js");
const store = require("../../../src/stores/raiderProfileStore");
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
    it("heißt profil und antwortet nur dem Aufrufer — ohne Charakter nur mit dem Link", async () => {
        expect(command.name).toBe("profil");
        const interaction = mockInteraction({ userId: USER, commandName: "profil" });
        await command.execute(interaction);
        const arg = interaction.reply.mock.calls[0][0];
        expect(arg.flags).toBe(MessageFlags.Ephemeral);
        expect(embedText(arg)).toContain("No character yet");
        const [link, more] = arg.components[0].components.map((c) => c.data);
        expect(link.url).toMatch(/\/profile$/);
        expect(more).toBeUndefined();
    });

    it("fasst Charaktere, Specs mit Gear-Stand, Schalter je Charakter und Tage zusammen", () => {
        store.addCharacter(USER, { name: "Nerathil", className: "Mage", specs: [{ key: "Mage-Arcane", gear: "ready" }] });
        store.addCharacter(USER, { name: "Bärbel", className: "Druid", specs: ["Druid-Guardian"] });
        const profile = store.saveProfile(USER, { availability: ["mi", "so"] });
        const text = command.summaryLines(profile).join("\n");
        expect(text).toContain("**Nerathil** · Main — Arcane (raid ready)\n");
        expect(text).toContain("**Bärbel** — Feral (Bear) (usable) · can off-tank");
        expect(text).toContain("Available: Wed · Sun");
    });

    it("schaltet per Button am Main um und speichert es im eigenen Profil", async () => {
        store.addCharacter(USER, { name: "Bärbel", className: "Druid", specs: ["Druid-Guardian"] });
        store.addCharacter(USER, { name: "Nerathil", className: "Mage", specs: ["Mage-Arcane"] });
        const interaction = mockInteraction({ userId: USER, customId: "profil:tank" });
        await command.execute(interaction);
        // vorgeschlagen war "kann Offtank" (Bär), der Klick schaltet es aus — nur am Main
        const saved = store.getProfile(USER);
        expect(saved.characters.find((c) => c.key === "bärbel").canOfftank).toBe(false);
        expect(saved.characters.find((c) => c.key === "nerathil").canOfftank).toBeNull();
        const [tank] = interaction.update.mock.calls[0][0].components[0].components.map((c) => c.data);
        expect(tank.label).toBe("Bärbel: can off-tank");

        await command.execute(mockInteraction({ userId: USER, customId: "profil:heal" }));
        expect(store.getProfile(USER).characters[0].canHeal).toBe(true);
    });

    it("zeigt nur die Schalter, die die Klasse des Mains überhaupt kann", async () => {
        store.addCharacter(USER, { name: "Nerathil", className: "Mage", specs: ["Mage-Arcane"] });
        const interaction = mockInteraction({ userId: USER, commandName: "profil" });
        await command.execute(interaction);
        const ids = interaction.reply.mock.calls[0][0].components[0].components.map((c) => c.data.custom_id);
        expect(ids).toEqual([undefined]); // nur der Link
        // ein alter Button-Klick ändert nichts
        await command.execute(mockInteraction({ userId: USER, customId: "profil:heal" }));
        expect(store.getProfile(USER).characters[0].canHeal).toBeNull();
    });
});

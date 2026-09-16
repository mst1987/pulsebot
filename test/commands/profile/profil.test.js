// /profil: kurze Zusammenfassung des eigenen Profils, Link ins Web und die
// Schnell-Schalter "kann Offtank" / "kann heilen".
const os = require("os");
const path = require("path");
const store = require("../../../src/web/raiderProfileStore");
const command = require("../../../src/commands/profile/profil");
const { mockInteraction } = require("../../helpers/mockInteraction");

const USER = "300000000000000001";

beforeAll(() => store.useFile(path.join(os.tmpdir(), `eh-profiles-cmd-${process.pid}.json`)));
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
        expect(arg.ephemeral).toBe(true);
        expect(embedText(arg)).toContain("Noch kein Charakter");
        const [tank, heal, link] = arg.components[0].components.map((c) => c.data);
        expect(tank.custom_id).toBe("profil:tank");
        expect(heal.custom_id).toBe("profil:heal");
        expect(link.url).toMatch(/\/profile$/);
    });

    it("fasst Charaktere, Specs mit Gear-Stand und Tage zusammen", () => {
        store.addCharacter(USER, { name: "Nerathil", className: "Mage", specs: [{ key: "Mage-Arcane", gear: "ready" }] });
        const profile = store.saveProfile(USER, { availability: ["mi", "so"] });
        const text = command.summaryLines(profile).join("\n");
        expect(text).toContain("**Nerathil** · Main — Arkan (raidbereit)");
        expect(text).toContain("Offtank: nein · Heilen: nein");
        expect(text).toContain("Verfügbar: Mi · So");
    });

    it("schaltet per Button um und speichert es im eigenen Profil", async () => {
        store.addCharacter(USER, { name: "Bärbel", className: "Druid", specs: ["Druid-Guardian"] });
        const interaction = mockInteraction({ userId: USER, customId: "profil:tank" });
        await command.execute(interaction);
        // vorgeschlagen war "kann Offtank" (Bär), der Klick schaltet es aus
        expect(store.getProfile(USER).canOfftank).toBe(false);
        expect(embedText(interaction.update.mock.calls[0][0])).toContain("Offtank: nein");

        await command.execute(mockInteraction({ userId: USER, customId: "profil:heal" }));
        expect(store.getProfile(USER).canHeal).toBe(true);
    });
});

// Die Orga-Knöpfe unter einer Gildenbank-Anfrage: Erledigt, Ablehnen (Modal mit
// Grund), nur mit Schreibrecht auf Raids, schon erledigte Anfragen.
const { MessageFlags } = require("discord.js");
const { cardText, cardColor } = require("../../helpers/cardText");
const { KIND_COLORS } = require("../../../src/utils/discord/card");

/** The text of the first call of a reply mock; `ephemeral` asserts the card is only for the clicker. */
const said = (fn, ephemeral = false) => {
    const sent = fn.mock.calls[0][0];
    if (ephemeral) expect(sent.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
    return cardText(sent);
};

jest.mock("../../../src/services/discord/userAccess", () => ({ userMayAny: jest.fn(async () => true) }));
jest.mock("../../../src/services/signups/guildBank", () => ({
    resolveRequest: jest.fn(async () => ({ request: { status: "done", userName: "Anna" }, posted: true, dm: true })),
    redrawPost: jest.fn(async () => true),
    confirmRequest: jest.fn(async () => ({ request: { status: "confirmed", userName: "Anna" }, posted: true, dm: true })),
    handOutRequest: jest.fn(async () => ({ request: { status: "handedOut", userName: "Anna" }, posted: true, dm: true })),
    releaseRequest: jest.fn(async () => ({ request: { status: "open", userName: "Anna" }, posted: false, dm: false })),
}));

const { userMayAny } = require("../../../src/services/discord/userAccess");
const guildBank = require("../../../src/services/signups/guildBank");
const store = require("../../../src/stores/guildBankStore");
const command = require("../../../src/commands/signup/guildBank");
const { kindOf } = require("../../../src/commands/loader");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { tempStoreFile } = require("../../helpers/tempStore");

const ORGA = "300000000000000001";
const click = (customId, extra = {}) => mockInteraction({ customId, userId: ORGA, ...extra });

let open;
beforeAll(() => store.useFile(tempStoreFile("eh-cmd-guild-bank.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    for (const r of store.listRequests()) store.removeRequest(r.id);
    open = store.addRequest({ userId: "u1", userName: "Anna", item: "Flask", amount: 2 }).request;
    userMayAny.mockResolvedValue(true);
});

describe("guildbank (Orga-Knöpfe)", () => {
    it("ist ein Knopf-Modul der Anmeldung ohne Slash-Befehl, das Recht prüft es selbst", () => {
        expect(command).toMatchObject({ name: "guildbank", group: "signup", defaultAccess: "everyone" });
        expect(command.data).toBeUndefined();
        expect(kindOf(command)).toBe("component");
    });

    it("Erledigt löst die Anfrage sofort und sagt, dass die DM rausging", async () => {
        const i = click(`guildbank:done:${open.id}`);
        i.member = { displayName: "Orga-Olli" };
        await command.execute(i);
        expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
        expect(userMayAny).toHaveBeenCalledWith(ORGA, ["raids"], "write");
        expect(guildBank.resolveRequest).toHaveBeenCalledWith(open.id, { by: ORGA, byName: "Orga-Olli", status: "done", reason: "" });
        expect(said(i.editReply)).toContain("Erledigt");
        expect(said(i.editReply)).toContain("Anna bekommt eine DM.");
    });

    it("sagt, wenn die DM nicht ankam oder der Post nicht aktualisiert wurde", async () => {
        guildBank.resolveRequest.mockResolvedValueOnce({ request: { status: "rejected", userName: "" }, posted: false, dm: false });
        const i = click(`guildbank:done:${open.id}`);
        await command.execute(i);
        const content = said(i.editReply);
        expect(content).toContain("Abgelehnt");
        expect(content).toContain("Die DM an den Raider kam nicht an");
        expect(content).toContain("Der Post im Kanal ließ sich nicht aktualisieren.");
    });

    it("ohne Schreibrecht auf Raids: nur ein Hinweis, nichts passiert", async () => {
        userMayAny.mockResolvedValue(false);
        const done = click(`guildbank:done:${open.id}`);
        await command.execute(done);
        expect(said(done.editReply)).toContain("Das darf nur die Orga mit Raid-Rechten.");
        const reject = click(`guildbank:reject:${open.id}`);
        await command.execute(reject);
        expect(reject.showModal).not.toHaveBeenCalled();
        expect(said(reject.reply, true)).toContain("Das darf nur die Orga mit Raid-Rechten.");
        expect(guildBank.resolveRequest).not.toHaveBeenCalled();
    });

    it("Ablehnen öffnet das Modal, das Modal lehnt mit Grund ab", async () => {
        const btn = click(`guildbank:reject:${open.id}`);
        await command.execute(btn);
        expect(btn.showModal.mock.calls[0][0].toJSON().custom_id).toBe(`guildbank:mreject:${open.id}`);

        const modal = mockInteraction({ customId: `guildbank:mreject:${open.id}`, userId: ORGA, modal: true, options: { reason: " gerade leer " } });
        await command.execute(modal);
        expect(guildBank.resolveRequest).toHaveBeenCalledWith(open.id, { by: ORGA, byName: "tester", status: "rejected", reason: "gerade leer" });
    });

    it("eine schon erledigte Anfrage: Hinweis und der Post wird neu gezeichnet", async () => {
        store.resolveRequest(open.id, { status: "done", by: "x", byName: "X" });
        const btn = click(`guildbank:reject:${open.id}`);
        await command.execute(btn);
        expect(btn.showModal).not.toHaveBeenCalled();
        expect(said(btn.reply, true)).toContain("Diese Anfrage ist schon erledigt.");
        expect(guildBank.redrawPost).toHaveBeenCalledWith(expect.objectContaining({ id: open.id, status: "done" }));

        guildBank.resolveRequest.mockResolvedValueOnce({ error: "Diese Anfrage ist schon erledigt.", request: { id: open.id } });
        const done = click(`guildbank:done:${open.id}`);
        await command.execute(done);
        expect(said(done.editReply)).toContain("Diese Anfrage ist schon erledigt.");
    });

    it("eine verschwundene Anfrage und unbekannte Aktionen", async () => {
        const gone = click("guildbank:reject:nope");
        await command.execute(gone);
        expect(said(gone.reply, true)).toContain("Diese Anfrage gibt es nicht mehr.");

        guildBank.resolveRequest.mockResolvedValueOnce({ error: "Anfrage nicht gefunden." });
        const done = click("guildbank:done:nope");
        await command.execute(done);
        expect(said(done.editReply)).toContain("Diese Anfrage gibt es nicht mehr.");

        for (const id of ["guildbank:what:1", "guildbank:done:"]) {
            const i = click(id);
            await command.execute(i);
            expect(said(i.reply, true)).toContain("Unbekannte Aktion.");
        }
    });

    describe("eine Anfrage aus dem Bestand (#633)", () => {
        it("Bestätigen merkt vor und sagt, dass die DM rausging", async () => {
            guildBank.confirmRequest.mockResolvedValueOnce({ request: { status: "confirmed", userName: "Anna" }, posted: true, dm: true });
            const i = click(`guildbank:confirm:${open.id}`);
            i.member = { displayName: "Arthas" };
            await command.execute(i);
            expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
            expect(guildBank.confirmRequest).toHaveBeenCalledWith(open.id, { by: ORGA, byName: "Arthas" });
            expect(said(i.editReply)).toBe("## Vorgemerkt\nAnna bekommt eine DM.");
        });

        it("Bestätigen ohne genug Bestand: ein Hinweis mit den Zahlen", async () => {
            guildBank.confirmRequest.mockResolvedValueOnce({ error: "Nicht genug verfügbar: noch 2, angefragt 5.", request: { id: open.id, status: "open" }, available: 2 });
            const i = click(`guildbank:confirm:${open.id}`);
            await command.execute(i);
            expect(said(i.editReply)).toBe("## Nicht genug verfügbar\nNicht genug verfügbar: noch 2, angefragt 5.");
        });

        it("Ausgegeben beendet die Vormerkung über den Knopf, Vormerkung lösen ohne DM", async () => {
            const out = click(`guildbank:handout:${open.id}`);
            await command.execute(out);
            expect(guildBank.handOutRequest).toHaveBeenCalledWith(open.id, { by: ORGA, byName: "tester", via: "discord" });
            expect(said(out.editReply)).toContain("## Ausgegeben");

            const release = click(`guildbank:release:${open.id}`);
            await command.execute(release);
            expect(guildBank.releaseRequest).toHaveBeenCalledWith(open.id);
            expect(said(release.editReply)).toBe("## Vormerkung gelöst\n-# Der Post im Kanal ließ sich nicht aktualisieren.");
        });

        it("ein schon ausgegebener oder freier Eintrag: die Meldung des Speichers", async () => {
            guildBank.handOutRequest.mockResolvedValueOnce({ error: "Diese Anfrage ist schon ausgegeben.", request: { id: open.id, status: "handedOut" } });
            const i = click(`guildbank:handout:${open.id}`);
            await command.execute(i);
            expect(said(i.editReply)).toBe("## Diese Anfrage ist schon ausgegeben.");
        });

        it("eine DM, die nicht ankam, und ein Name aus dem Discord-Konto", async () => {
            guildBank.confirmRequest.mockResolvedValueOnce({ request: { status: "confirmed", userName: "" }, posted: true, dm: false });
            const i = click(`guildbank:confirm:${open.id}`);
            i.member = null;
            i.user.globalName = "Global Olli";
            await command.execute(i);
            expect(guildBank.confirmRequest).toHaveBeenCalledWith(open.id, { by: ORGA, byName: "Global Olli" });
            const sent = i.editReply.mock.calls[0][0];
            expect(said(i.editReply)).toBe("## Vorgemerkt\nDie DM an den Raider kam nicht an – sind die DMs zu?");
            expect(cardColor(sent)).toBe(KIND_COLORS.warn);

            guildBank.handOutRequest.mockResolvedValueOnce({ request: { status: "weird" }, posted: true, dm: true });
            const odd = click(`guildbank:handout:${open.id}`);
            odd.member = { nick: "Nick" };
            await command.execute(odd);
            expect(said(odd.editReply)).toContain("## Erledigt");
        });

        it("ein Ablehnen-Modal ohne Grundfeld lehnt ohne Grund ab", async () => {
            const modal = mockInteraction({ customId: `guildbank:mreject:${open.id}`, userId: ORGA, modal: true });
            modal.fields.getTextInputValue = jest.fn(() => { throw new Error("no field"); });
            await command.execute(modal);
            expect(guildBank.resolveRequest).toHaveBeenCalledWith(open.id, expect.objectContaining({ status: "rejected", reason: "" }));
        });

        it("ohne Schreibrecht auf Raids: weder bestätigen noch ausgeben", async () => {
            userMayAny.mockResolvedValue(false);
            for (const action of ["confirm", "handout", "release"]) {
                const i = click(`guildbank:${action}:${open.id}`);
                await command.execute(i);
                expect(said(i.editReply)).toContain("Das darf nur die Orga mit Raid-Rechten.");
            }
            expect(guildBank.confirmRequest).not.toHaveBeenCalled();
            expect(guildBank.handOutRequest).not.toHaveBeenCalled();
            expect(guildBank.releaseRequest).not.toHaveBeenCalled();
        });
    });
});

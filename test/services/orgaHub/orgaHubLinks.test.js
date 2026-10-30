// The orga links of the Orga-Zentrale in Discord (services/orgaHub/orgaHubLinks.js through
// commands/event/orgaHubButton.js): the "Links ..." card, the add / edit modals, the remove
// select — each with the order "acknowledge first, check afterwards" and the orga rule of
// "Raid anlegen". The hub service is mocked (it redraws), the hub store is real.
jest.mock("../../../src/services/events/eventDraft", () => ({
    guildFor: (i) => (i.guildId === "g1" ? { guildId: "g1" } : { error: "Events legst du auf dem Event-Server an." }),
    initialState: jest.fn(),
    stepMessage: jest.fn(),
    clearNamePattern: jest.fn(),
}));
jest.mock("../../../src/services/discord/userAccess", () => ({ resolveAccess: jest.fn() }));
jest.mock("../../../src/services/roster/categoryRoster", () => ({ currentRoster: jest.fn((cat) => (cat === "cat1" ? { id: "r1", guildId: "g1", managers: { userIds: ["mgr"], roleIds: [] } } : null)) }));
jest.mock("../../../src/services/signups/availabilityPanel", () => ({ categoryNameFor: jest.fn(() => "╭・ TBC Montag") }));
jest.mock("../../../src/services/orgaHub/orgaHub", () => ({ saveLinks: jest.fn() }));

const { MessageFlags } = require("discord.js");
const { resolveAccess } = require("../../../src/services/discord/userAccess");
const orgaHub = require("../../../src/services/orgaHub/orgaHub");
const store = require("../../../src/stores/orgaHubStore");
const links = require("../../../src/services/orgaHub/orgaHubLinks");
const button = require("../../../src/commands/event/orgaHubButton");
const { cardText, cardControls } = require("../../helpers/cardText");
const { tempStoreFile } = require("../../helpers/tempStore");

const A = { label: "WCL", url: "https://www.warcraftlogs.com/guild/x" };
const B = { label: "Sheet", url: "https://docs.example/sheet" };

/** A fake interaction; `kind` = "button" | "select" | "modal". */
function interaction(customId, { kind = "button", userId = "mgr", guildId = "g1", values, fields } = {}) {
    return {
        customId, guildId, user: { id: userId }, values,
        isModalSubmit: () => kind === "modal",
        fields: { getTextInputValue: (id) => (fields && fields[id] !== undefined ? fields[id] : "") },
        reply: jest.fn(async () => {}),
        deferReply: jest.fn(async () => {}),
        deferUpdate: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
    };
}

const ephemeral = (payload) => (payload.flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral;
const lastCard = (i) => i.editReply.mock.calls.at(-1)[0];
const hashOf = links.hashOf;

beforeAll(() => store.useFile(tempStoreFile("orga-hubs.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    jest.clearAllMocks();
    store.setLinks("cat1", []);
    store.setLinks("cat2", []);
    for (const h of store.listHubs()) store.removeHub(h.categoryId);
    store.setHub({ categoryId: "cat1", guildId: "g1", channelId: "c1", messageId: "m1" });
    store.setHub({ categoryId: "cat2", guildId: "g1", channelId: "c2", messageId: "m2" });
    store.setHub({ categoryId: "cat3", guildId: "other", channelId: "c3", messageId: "m3" });
    resolveAccess.mockResolvedValue({ isAdmin: false, access: {} });
    // the real service saves into the store, then the hub would be redrawn
    orgaHub.saveLinks.mockImplementation(async (cat, list) => store.setLinks(cat, list));
});

describe("orga:links — the card", () => {
    it("acknowledges ephemerally first, then answers with the links and the controls", async () => {
        store.setLinks("cat1", [A, B]);
        const i = interaction("orga:links:cat1");
        await button.execute(i);
        expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
        expect(i.deferReply.mock.invocationCallOrder[0]).toBeLessThan(resolveAccess.mock.invocationCallOrder[0]);
        const text = cardText(lastCard(i));
        expect(text).toContain("Orga-Zentrale · TBC Montag");
        expect(text).toContain("1. **WCL** · <https://www.warcraftlogs.com/guild/x>");
        expect(text).toContain("2. **Sheet**");
        const controls = cardControls(lastCard(i));
        expect(controls.map((c) => c.custom_id)).toEqual(["orga:ledit:cat1", "orga:ldel:cat1", "orga:ladd:cat1"]);
        const del = controls.find((c) => c.custom_id === "orga:ldel:cat1");
        expect(del.placeholder).toBe("Link entfernen …");
        expect(del.options.map((o) => [o.label, o.value])).toEqual([["WCL", `0:${hashOf(A)}`], ["Sheet", `1:${hashOf(B)}`]]);
        expect(controls.find((c) => c.custom_id === "orga:ladd:cat1").disabled).toBeFalsy();
    });

    it("offers only \"Link hinzufügen\" while there are no links", async () => {
        const i = interaction("orga:links:cat1");
        await button.execute(i);
        expect(cardControls(lastCard(i)).map((c) => c.custom_id)).toEqual(["orga:ladd:cat1"]);
        expect(cardText(lastCard(i))).toContain("Noch keine Links");
    });

    it("disables \"Link hinzufügen\" with a hint at five links", async () => {
        store.setLinks("cat1", [1, 2, 3, 4, 5].map((n) => ({ label: `L${n}`, url: `https://a.example/${n}` })));
        const i = interaction("orga:links:cat1");
        await button.execute(i);
        expect(cardControls(lastCard(i)).find((c) => c.custom_id === "orga:ladd:cat1").disabled).toBe(true);
        expect(cardText(lastCard(i))).toContain("Höchstens 5 Links");
    });

    it("refuses who is not the orga of the category, with the same rule as \"Raid anlegen\"", async () => {
        const stranger = interaction("orga:links:cat1", { userId: "u1" });
        await button.execute(stranger);
        expect(cardText(lastCard(stranger))).toContain(links.DENIED);
        expect(cardControls(lastCard(stranger))).toEqual([]);

        resolveAccess.mockResolvedValue({ isAdmin: false, isOrga: true, access: {} });
        const globalOrga = interaction("orga:links:cat2", { userId: "u1" });
        await button.execute(globalOrga);
        expect(cardText(lastCard(globalOrga))).not.toContain(links.DENIED);
    });

    it("treats the category id as untrusted: no hub on this server, no card", async () => {
        for (const cat of ["nope", "cat3", ""]) {
            const i = interaction(`orga:links:${cat}`);
            await button.execute(i);
            expect(cardText(lastCard(i))).toContain("gibt es nicht mehr");
        }
    });

    it("answers another server and an unknown action ephemerally", async () => {
        const elsewhere = interaction("orga:links:cat1", { guildId: "g2" });
        await button.execute(elsewhere);
        expect(elsewhere.deferReply).not.toHaveBeenCalled();
        expect(ephemeral(elsewhere.reply.mock.calls[0][0])).toBe(true);
        expect(links.parseLinkId("orga:lsave:cat1:2:abcd1234")).toEqual({ action: "lsave", categoryId: "cat1", index: 2, hash: "abcd1234" });
    });
});

describe("orga:ladd — add a link", () => {
    it("opens the modal as the direct answer, without acknowledging or checking anything", async () => {
        const i = interaction("orga:ladd:cat1", { userId: "u1" });
        await button.execute(i);
        expect(i.showModal).toHaveBeenCalledTimes(1);
        expect(i.deferReply).not.toHaveBeenCalled();
        expect(resolveAccess).not.toHaveBeenCalled();
        const modal = i.showModal.mock.calls[0][0].toJSON();
        expect(modal.custom_id).toBe("orga:ladd:cat1");
        const fields = modal.components.map((r) => r.components[0]);
        expect(fields.map((f) => f.custom_id)).toEqual(["label", "url", "emoji"]);
        expect(fields[0].max_length).toBe(store.LINK_LABEL_MAX);
        expect(fields.every((f) => !f.value)).toBe(true);
        expect(fields.map((f) => f.required)).toEqual([true, true, false]);
    });

    it("does not open it for a category without a hub on this server", async () => {
        const i = interaction("orga:ladd:cat3");
        await button.execute(i);
        expect(i.showModal).not.toHaveBeenCalled();
        expect(ephemeral(i.reply.mock.calls[0][0])).toBe(true);
    });

    it("saves on submit (deferUpdate first, then the orga check), redraws and updates the card", async () => {
        store.setLinks("cat1", [A]);
        const i = interaction("orga:ladd:cat1", { kind: "modal", fields: { label: " Sheet ", url: " https://docs.example/sheet " } });
        await button.execute(i);
        expect(i.deferUpdate.mock.invocationCallOrder[0]).toBeLessThan(resolveAccess.mock.invocationCallOrder[0]);
        expect(orgaHub.saveLinks).toHaveBeenCalledWith("cat1", [A, { label: "Sheet", url: "https://docs.example/sheet" }]);
        expect(store.getLinks("cat1")).toEqual([A, B]);
        expect(cardText(lastCard(i))).toContain("Link „Sheet“ hinzugefügt.");
        expect(cardText(lastCard(i))).toContain("2. **Sheet**");
    });

    it("refuses a submit from someone who may not (the modal could have been opened by anyone)", async () => {
        const i = interaction("orga:ladd:cat1", { kind: "modal", userId: "u1", fields: { label: "X", url: "https://x.example" } });
        await button.execute(i);
        expect(orgaHub.saveLinks).not.toHaveBeenCalled();
        expect(store.getLinks("cat1")).toEqual([]);
        expect(cardText(lastCard(i))).toContain(links.DENIED);
    });

    it("shows the store's refusal on the card and saves nothing", async () => {
        const i = interaction("orga:ladd:cat1", { kind: "modal", fields: { label: "X", url: "ftp://x.example" } });
        await button.execute(i);
        expect(cardText(lastCard(i))).toContain("braucht eine Adresse mit https://");
        expect(store.getLinks("cat1")).toEqual([]);
    });

    it("refuses a sixth link", async () => {
        store.setLinks("cat1", [1, 2, 3, 4, 5].map((n) => ({ label: `L${n}`, url: `https://a.example/${n}` })));
        const i = interaction("orga:ladd:cat1", { kind: "modal", fields: { label: "Six", url: "https://six.example" } });
        await button.execute(i);
        expect(cardText(lastCard(i))).toContain("Höchstens 5 Links");
        expect(store.getLinks("cat1")).toHaveLength(5);
    });
});

describe("orga:ledit / orga:lsave — edit a link", () => {
    it("opens the modal prefilled for the chosen link, again without a slow step", async () => {
        store.setLinks("cat1", [A, B]);
        const i = interaction("orga:ledit:cat1", { kind: "select", values: [`1:${hashOf(B)}`] });
        await button.execute(i);
        expect(resolveAccess).not.toHaveBeenCalled();
        const modal = i.showModal.mock.calls[0][0].toJSON();
        expect(modal.custom_id).toBe(`orga:lsave:cat1:1:${hashOf(B)}`);
        expect(modal.custom_id.length).toBeLessThanOrEqual(100);
        expect(modal.components.map((r) => r.components[0].value)).toEqual(["Sheet", "https://docs.example/sheet"]);
    });

    it("does not open it for a link that changed since the card was drawn", async () => {
        store.setLinks("cat1", [A, B]);
        const i = interaction("orga:ledit:cat1", { kind: "select", values: [`0:${hashOf(B)}`] });
        await button.execute(i);
        expect(i.showModal).not.toHaveBeenCalled();
        expect(cardText(i.reply.mock.calls[0][0])).toContain("Links haben sich geändert");
    });

    it("replaces that link on submit", async () => {
        store.setLinks("cat1", [A, B]);
        const i = interaction(`orga:lsave:cat1:0:${hashOf(A)}`, { kind: "modal", fields: { label: "WCL Gilde", url: "https://www.warcraftlogs.com/guild/y" } });
        await button.execute(i);
        expect(store.getLinks("cat1")).toEqual([{ label: "WCL Gilde", url: "https://www.warcraftlogs.com/guild/y" }, B]);
        expect(cardText(lastCard(i))).toContain("Link „WCL Gilde“ gespeichert.");
    });

    it("refuses a submit for a stale link, and for someone who may not", async () => {
        store.setLinks("cat1", [A, B]);
        const stale = interaction(`orga:lsave:cat1:1:${hashOf(A)}`, { kind: "modal", fields: { label: "X", url: "https://x.example" } });
        await button.execute(stale);
        expect(store.getLinks("cat1")).toEqual([A, B]);
        expect(cardText(lastCard(stale))).toContain("Die Links haben sich geändert");

        const stranger = interaction(`orga:lsave:cat1:0:${hashOf(A)}`, { kind: "modal", userId: "u1", fields: { label: "X", url: "https://x.example" } });
        await button.execute(stranger);
        expect(store.getLinks("cat1")).toEqual([A, B]);
        expect(cardText(lastCard(stranger))).toContain(links.DENIED);
    });
});

describe("orga:ldel — remove a link", () => {
    it("acknowledges, checks, removes the chosen link, redraws and updates the card", async () => {
        store.setLinks("cat1", [A, B]);
        const i = interaction("orga:ldel:cat1", { kind: "select", values: [`0:${hashOf(A)}`] });
        await button.execute(i);
        expect(i.deferUpdate.mock.invocationCallOrder[0]).toBeLessThan(resolveAccess.mock.invocationCallOrder[0]);
        expect(orgaHub.saveLinks).toHaveBeenCalledWith("cat1", [B]);
        expect(store.getLinks("cat1")).toEqual([B]);
        expect(cardText(lastCard(i))).toContain("Link „WCL“ entfernt.");
    });

    it("removes nothing for a stale choice and nothing for someone who may not", async () => {
        store.setLinks("cat1", [A, B]);
        const stale = interaction("orga:ldel:cat1", { kind: "select", values: [`0:${hashOf(B)}`] });
        await button.execute(stale);
        expect(cardText(lastCard(stale))).toContain("Die Links haben sich geändert");

        const stranger = interaction("orga:ldel:cat1", { kind: "select", userId: "u1", values: [`0:${hashOf(A)}`] });
        await button.execute(stranger);
        expect(cardText(lastCard(stranger))).toContain(links.DENIED);
        expect(store.getLinks("cat1")).toEqual([A, B]);
        expect(orgaHub.saveLinks).not.toHaveBeenCalled();
    });

    it("cannot reach another category's hub through a made-up customId", async () => {
        store.setLinks("cat3", [A]);
        const i = interaction("orga:ldel:cat3", { kind: "select", values: [`0:${hashOf(A)}`] });
        await button.execute(i);
        expect(store.getLinks("cat3")).toEqual([A]);
    });
});

describe("customIds", () => {
    it("stay within Discord's 100 characters with a snowflake category id", () => {
        const cat = "1139509316387344395";
        const card = links.linksCard(cat);
        store.setLinks(cat, [A]);
        for (const c of cardControls(links.linksCard(cat))) expect(c.custom_id.length).toBeLessThanOrEqual(100);
        expect(card).toBeTruthy();
        expect(links.linkModal(cat, { prefill: A, index: 4 }).toJSON().custom_id.length).toBeLessThanOrEqual(100);
    });
});

describe("Emoji im Modal", () => {
    it("zeigt ein optionales Emoji-Feld, vorbelegt beim Bearbeiten", () => {
        const fields = (m) => m.toJSON().components.map((r) => r.components[0]);
        const added = fields(links.linkModal("cat1"));
        expect(added.map((f) => f.custom_id)).toEqual(["label", "url", "emoji"]);
        expect(added[2].required).toBe(false);
        expect(fields(links.linkModal("cat1", { prefill: { ...A, emoji: "📊" }, index: 0 }))[2].value).toBe("📊");
    });

    it("speichert das getippte Emoji, ohne Eingabe bleibt der Link wie früher", async () => {
        const i = interaction("orga:ladd:cat1", { kind: "modal", fields: { label: "WCL", url: A.url, emoji: " 📊 " } });
        await button.execute(i);
        expect(store.getLinks("cat1")).toEqual([{ ...A, emoji: "📊" }]);
        expect(cardText(lastCard(i))).toContain("1. 📊 **WCL**");
        const j = interaction("orga:ladd:cat1", { kind: "modal", fields: { label: "Sheet", url: B.url } });
        await button.execute(j);
        expect(orgaHub.saveLinks).toHaveBeenLastCalledWith("cat1", [{ ...A, emoji: "📊" }, B]);
    });

    it("meldet ein ungültiges Emoji im Karten-Hinweis und speichert nichts", async () => {
        const i = interaction("orga:ladd:cat1", { kind: "modal", fields: { label: "WCL", url: A.url, emoji: "xx" } });
        await button.execute(i);
        expect(cardText(lastCard(i))).toContain("kein einzelnes Emoji");
        expect(store.getLinks("cat1")).toEqual([]);
    });
});

// System › Discord › Übersicht: what needs attention (order, tone, links the
// account may open), the bot check of the shown server, the role-hygiene line and
// the throttle of "Neu prüfen".
import { afterEach, describe, expect, it } from "vitest";
import type { BotMessage, DiscordOverview } from "../../api";
import { adminUser } from "../../test/render";
import { switchLang } from "../../test/i18n";
import { attentionItems, botCheckRank, botCheckRows, channelMissing, functionState, hygieneLine, messageStatus, purposeLabel, refreshWait, uncheckedLine } from "./overview";

function overview(over: Partial<DiscordOverview> = {}): DiscordOverview {
    return {
        guildId: "g1", online: true, members: [],
        botCheck: { guildId: "g1", known: true, functions: [], channels: [], rolesAboveBot: [] },
        messages: [],
        hygiene: { known: true, total: 12, empty: 0, aboveBot: 0, sensitive: 1 },
        ...over,
    };
}

function message(over: Partial<BotMessage>): BotMessage {
    return {
        kind: "roleMessage", kindLabel: "Rollen-Nachricht", title: "", categoryId: "", categoryName: "", guildId: "g1",
        channelId: "c1", channelName: "rollen", messageId: "m1", link: "", status: "ok", ...over,
    };
}

const BAD = overview({
    botCheck: {
        guildId: "g1", known: true,
        functions: [
            { key: "posts", label: "Event-Posts, Anmelder-Nachricht, Setup, Pings", state: "ok", rights: [{ key: "SendMessages", label: "Nachrichten senden", ok: true }] },
            { key: "roles", label: "Raider-Rollen, Rollen-Nachrichten, Rollen-Abgleich", state: "missing", rights: [{ key: "ManageRoles", label: "Rollen verwalten", ok: false }] },
        ],
        channels: [
            { key: "applications", label: "Bewerbungen", channelId: "", channelName: "", state: "not_set", missing: [] },
            { key: "logs", label: "Log-Kanal", channelId: "c9", channelName: "logs", state: "ok", missing: [] },
        ],
        rolesAboveBot: [{ id: "r1", name: "Naxx-Raider", usedBy: ["Raider-Rolle Naxx"] }],
    },
    messages: [
        message({ kind: "recruitment", kindLabel: "Rekrutierung", messageId: "m2", status: "no_access" }),
        message({ messageId: "m3", title: "Berufe", status: "deleted" }),
        message({ messageId: "m4", status: "ok" }),
    ],
    hygiene: { known: true, total: 40, empty: 3, aboveBot: 1, sensitive: 2 },
});

afterEach(async () => { await switchLang("de"); });

describe("attentionItems", () => {
    it("lists the bad points first, then the hints; empty roles only in the hygiene line", () => {
        const items = attentionItems(BAD, adminUser());
        expect(items.map((i) => [i.tone, i.status, i.what])).toEqual([
            ["bad", "fehlt", "Raider-Rollen, Rollen-Nachrichten, Rollen-Abgleich"],
            ["bad", "fehlt", "Bewerbungen"],
            ["bad", "gelöscht", "Rollen-Nachricht · Berufe"],
            ["mid", "Hinweis", "Naxx-Raider"],
            ["mid", "kein Zugriff", "Rekrutierung"],
        ]);
        expect(items[0].why).toBe("Recht fehlt: Rollen verwalten");
        expect(items[0].action).toEqual({ label: "Recht prüfen", to: "#bot-check" });
        expect(items[1].action).toEqual({ label: "Kanal zuordnen", to: "/channels" });
        expect(items[2].action).toEqual({ label: "Neu posten", to: "/channels/roles" });
        // a message the bot cannot see is not reposted: the channel's rights are what is wrong
        expect(items[4].action).toEqual({ label: "Kanalrechte prüfen", to: "/channels" });
    });

    it("hides a link the account may not open, keeps the in-page one", () => {
        const user = adminUser({ isAdmin: false, access: {} });
        const items = attentionItems(BAD, user);
        expect(items.find((i) => i.what === "Rekrutierung")!.action).toBeNull();
        expect(items.find((i) => i.what === "Bewerbungen")!.action).toBeNull();
        expect(items[0].action).toEqual({ label: "Recht prüfen", to: "#bot-check" });
    });

    it("says the bot is absent instead of everything being fine when it cannot check", () => {
        const data = overview({ botCheck: { guildId: "g1", known: false, functions: [], channels: [], rolesAboveBot: [] } });
        const items = attentionItems(data, adminUser());
        expect(items.map((i) => [i.id, i.tone, i.status, i.what])).toEqual([["bot-absent", "bad", "nicht prüfbar", "Bot"]]);
        expect(items[0].action).toBeNull();
    });

    it("says nothing while the bot is offline or no server is set", () => {
        expect(attentionItems({ ...BAD, online: false }, adminUser())).toEqual([]);
        expect(attentionItems({ ...BAD, guildId: "" }, adminUser())).toEqual([]);
        expect(attentionItems(overview(), adminUser())).toEqual([]);
    });

    it("names a channel without rights and one that is gone", () => {
        const data = overview({
            botCheck: {
                guildId: "g1", known: true, functions: [], rolesAboveBot: [],
                channels: [
                    { key: "guildBank", label: "Gildenbank-Anfragen", channelId: "c2", channelName: "bank", state: "missing", missing: ["Links einbetten"] },
                    { key: "logs", label: "Log-Kanal", channelId: "c3", channelName: "", state: "channel_missing", missing: [] },
                ],
            },
        });
        const items = attentionItems(data, adminUser());
        expect(items.map((i) => [i.status, i.why])).toEqual([
            ["fehlt", "In #bank fehlt: Links einbetten"],
            ["gelöscht", "Der eingestellte Kanal existiert nicht mehr"],
        ]);
    });
});

describe("bot check", () => {
    const talk = overview({
        guildId: "g2",
        botCheck: {
            guildId: "g2", known: true, channels: [], rolesAboveBot: [],
            functions: [
                { key: "roles", label: "Raider-Rollen, Rollen-Nachrichten, Rollen-Abgleich", state: "ok", rights: [{ key: "ManageRoles", label: "Rollen verwalten", ok: true }] },
                { key: "members", label: "Mitglieder- und Rollen-Abgleich, Neu und gegangen", state: "ok", rights: [{ key: "GuildMembers", label: "Mitglieder lesen (Intent)", ok: true }] },
            ],
        },
    });

    it("lists one row per function of the shown server, a missing right first", () => {
        const rows = botCheckRows(BAD);
        expect(rows.map((r) => r.key)).toEqual(["posts", "roles"]);
        expect(rows.map(botCheckRank)).toEqual([2, 0]);
        expect(functionState(rows[1].fn)).toEqual({ tone: "bad", text: "fehlt", missing: ["Rollen verwalten"] });
        expect(functionState(botCheckRows(talk)[0].fn)).toMatchObject({ tone: "ok", text: "ok" });
        expect(functionState(null)).toMatchObject({ tone: "muted", text: "–" });
    });

    it("has no rows for a server that is not set up", () => {
        expect(botCheckRows(overview({ guildId: "" }))).toEqual([]);
        expect(botCheckRows(null)).toEqual([]);
    });

    it("translates functions and rights to English", async () => {
        await switchLang("en");
        const rows = [...botCheckRows(BAD), ...botCheckRows(talk).slice(1)];
        expect(rows[1].label).toBe("Raider roles, role messages, role sync");
        expect(rows[2].rights).toEqual([{ key: "GuildMembers", label: "Read members (intent)" }]);
        expect(purposeLabel({ key: "signupNotes", label: "Vielleicht und Absagen (Kategorie)" })).toBe("Maybe and declines (category)");
    });
});

describe("messages and hygiene", () => {
    it("ranks a gone message before one without access", () => {
        expect(messageStatus(message({ status: "deleted" }))).toMatchObject({ tone: "bad", rank: 0 });
        expect(messageStatus(message({ status: "no_access" }))).toMatchObject({ tone: "mid", rank: 1 });
        expect(messageStatus(message({ status: "ok" }))).toMatchObject({ tone: "ok", text: "steht", rank: 3 });
    });

    it("counts the roles in words and leaves out what the bot cannot say", () => {
        expect(hygieneLine({ known: true, total: 40, empty: 3, aboveBot: 1, sensitive: 1 })).toBe("40 Rollen · 3 ohne Mitglieder · 1 mit heiklen Rechten");
        expect(hygieneLine({ known: true, total: 1, empty: null, aboveBot: null, sensitive: null })).toBe("1 Rolle");
        expect(hygieneLine({ known: false, total: null, empty: null, aboveBot: null, sensitive: null })).toBe("");
    });

    it("counts the messages the bot could not check as one calm line", () => {
        expect(uncheckedLine([message({ status: "unknown" }), message({ messageId: "m2", status: "unknown" }), message({ status: "ok" })])).toBe("2 Nachrichten nicht geprüft");
        expect(uncheckedLine([message({ status: "unknown" })])).toBe("1 Nachricht nicht geprüft");
        expect(uncheckedLine([message({ status: "deleted" })])).toBe("");
    });
});

describe("channelMissing", () => {
    it("names the missing rights from their keys in the active language", async () => {
        const c = { missing: ["Links einbetten", "Verlauf (Server)"], missingKeys: ["EmbedLinks", "ReadMessageHistory"] };
        expect(channelMissing(c)).toEqual(["Links einbetten", "Nachrichtenverlauf anzeigen"]);
        await switchLang("en");
        expect(channelMissing(c)).toEqual(["Embed links", "Read message history"]);
    });

    it("keeps the server's labels when no keys came along", () => {
        expect(channelMissing({ missing: ["Links einbetten"] })).toEqual(["Links einbetten"]);
    });
});

describe("refreshWait", () => {
    it("counts the seconds left of the 30-second gap", () => {
        expect(refreshWait(0, 5000)).toBe(0);
        expect(refreshWait(1000, 1000)).toBe(30);
        expect(refreshWait(1000, 30500)).toBe(1);
        expect(refreshWait(1000, 31000)).toBe(0);
        expect(refreshWait(1000, 11000, 10000)).toBe(0);
    });
});

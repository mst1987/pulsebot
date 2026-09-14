const { PURPOSES, resolvePurposes, purposeSummary, channelStatus, idsFor } = require("../../src/web/channelPurposes");

const ch = (id, name, rights = {}) => ({ id, name, type: 0, botCanView: true, botCanSend: true, ...rights });

describe("channelPurposes", () => {
    it("lists the five purposes with their WoW icons and config keys", () => {
        expect(PURPOSES.map((p) => [p.id, p.icon, p.key])).toEqual([
            ["raid", "inv_misc_note_02", "raidDefaults.channelId"],
            ["logs", "inv_misc_pocketwatch_01", "logChannelIds"],
            ["application", "inv_misc_grouplooking", "applicationChannelId"],
            ["highestBids", "inv_misc_coin_01", "highestBidsChannelId"],
            ["eventCategories", "achievement_boss_illidan", "categoryIds"],
        ]);
        expect(PURPOSES.filter((p) => p.multiple).map((p) => p.id)).toEqual(["logs", "eventCategories"]);
    });

    it("reads the ids from the config, trimmed and de-duplicated", () => {
        const cfg = { raidDefaults: { channelId: " 1 " }, logChannelIds: ["2", "2", ""], applicationChannelId: "" };
        expect(idsFor(PURPOSES[0], cfg)).toEqual(["1"]);
        expect(idsFor(PURPOSES[1], cfg)).toEqual(["2"]);
        expect(idsFor(PURPOSES[2], cfg)).toEqual([]);
        expect(idsFor(PURPOSES[0], undefined)).toEqual([]);
    });

    describe("channelStatus", () => {
        it("says what the bot may do, by what the purpose needs", () => {
            expect(channelStatus(ch("1", "a"), "send")).toMatchObject({ tone: "ok", label: "Bot schreibt" });
            expect(channelStatus(ch("1", "a"), "read")).toMatchObject({ tone: "ok", label: "Bot liest mit" });
            expect(channelStatus(ch("1", "a", { botCanSend: false }), "send")).toMatchObject({ tone: "mid", label: "Bot darf nicht schreiben" });
            expect(channelStatus(ch("1", "a", { botCanView: false, botCanSend: false }), "read")).toMatchObject({ tone: "mid", label: "Bot sieht den Kanal nicht" });
            expect(channelStatus(undefined, "send")).toMatchObject({ tone: "mid", label: "Kanal nicht gefunden" });
        });

        it("warns about nothing while the bot is offline", () => {
            expect(channelStatus(undefined, "send", false)).toMatchObject({ tone: "", label: "gesetzt" });
        });

        it("explains a warning in the tooltip, naming the channel", () => {
            expect(channelStatus(ch("1", "offi-logs", { botCanView: false }), "read").tip).toMatch(/#offi-logs.*Kanal ansehen/);
        });
    });

    describe("resolvePurposes", () => {
        const channels = [ch("mo", "mo-logs"), ch("do", "do-logs"), ch("bw", "bewerbungen"), ch("an", "anmeldung", { botCanSend: false })];
        const categories = [{ id: "k1", name: "Raid Montag" }, { id: "k2", name: "Raid Donnerstag" }];
        const config = {
            raidDefaults: { templateId: "x", channelId: "an" },
            logChannelIds: ["mo", "do"],
            applicationChannelId: "bw",
            highestBidsChannelId: "",
            categoryIds: ["k1", "k2"],
        };

        it("resolves every purpose to its channels and a status", () => {
            const byId = Object.fromEntries(resolvePurposes(config, channels, categories).map((p) => [p.id, p]));
            expect(byId.raid.status).toMatchObject({ tone: "mid", label: "Bot darf nicht schreiben" });
            expect(byId.logs.items.map((i) => i.name)).toEqual(["mo-logs", "do-logs"]);
            expect(byId.logs.status).toMatchObject({ tone: "ok", label: "Bot liest mit" });
            expect(byId.application.status).toMatchObject({ tone: "ok", label: "Bot schreibt" });
            expect(byId.highestBids.status).toMatchObject({ tone: "bad", label: "fehlt" });
            expect(byId.highestBids.status.tip).toMatch(/Höchstgebote-Übersicht/);
            expect(byId.eventCategories.items.map((i) => i.name)).toEqual(["Raid Montag", "Raid Donnerstag"]);
            expect(byId.eventCategories.status).toMatchObject({ tone: "ok", label: "2 Kategorien" });
            // The page stores a change under exactly this key; the fallback text stays on the server.
            expect(byId.raid.key).toBe("raidDefaults.channelId");
            expect(byId.raid).not.toHaveProperty("missing");
        });

        it("flags a stored channel or category that no longer exists", () => {
            const byId = Object.fromEntries(resolvePurposes({ applicationChannelId: "gone", categoryIds: ["k9"] }, channels, categories).map((p) => [p.id, p]));
            expect(byId.application.items[0]).toMatchObject({ id: "gone", found: false });
            expect(byId.application.status.label).toBe("Kanal nicht gefunden");
            expect(byId.eventCategories.status).toMatchObject({ tone: "mid", label: "1 nicht gefunden" });
        });

        it("does not turn a multi-channel purpose yellow for a channel of another server", () => {
            const logs = resolvePurposes({ logChannelIds: ["mo", "elsewhere"] }, channels, categories).find((p) => p.id === "logs");
            expect(logs.items[1].status.label).toBe("Kanal nicht gefunden");
            expect(logs.status).toMatchObject({ tone: "ok", label: "Bot liest mit" });
        });

        it("keeps quiet about rights while the bot is not connected", () => {
            const list = resolvePurposes(config, [], [], false);
            expect(list.find((p) => p.id === "application").status).toMatchObject({ tone: "", label: "gesetzt" });
            expect(list.find((p) => p.id === "eventCategories").status).toMatchObject({ tone: "", label: "2 Kategorien" });
            expect(list.find((p) => p.id === "highestBids").status.tone).toBe("bad");
        });

        it("summarises set, missing and not-working purposes", () => {
            expect(purposeSummary(resolvePurposes(config, channels, categories))).toEqual({ set: 4, missing: 1, warnings: 1 });
            expect(purposeSummary(undefined)).toEqual({ set: 0, missing: 0, warnings: 0 });
        });
    });
});

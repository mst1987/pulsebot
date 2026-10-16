// The addon download centre as Discord messages (src/services/addons/addonCenterPanel.js):
// the centre (Board 1) with its patch notes links, Discord's limits. There is no
// update message any more: a new version is announced nowhere.
const { ComponentType, MessageFlags, ButtonStyle } = require("discord.js");
const panel = require("../../../src/services/addons/addonCenterPanel");
const { webUrl } = require("../../../src/utils/discord/botLookup");
const { defaultAddons } = require("../../../src/services/addons/addonConfig");

const NOW = Date.UTC(2026, 9, 14, 10, 0, 0);
const DAY = 86400000;

/** Every component of a payload, nested ones included (what Discord counts). */
function all(list) {
    return (list || []).flatMap((c) => [c, ...all(c.components), ...(c.accessory ? [c.accessory] : [])]);
}
const texts = (payload) => all(payload.components).filter((c) => c.type === ComponentType.TextDisplay).map((c) => c.content);
const buttons = (payload) => all(payload.components).filter((c) => c.type === ComponentType.Button);

const addon = (id, over = {}) => ({ ...(defaultAddons().find((a) => a.id === id) || { id, name: id, description: `${id} macht etwas.` }), ...over });
const release = (version = "0.3.0", over = {}) => ({ version, tag: `v${version}`, publishedAt: "2026-10-12T09:00:00Z", notes: "", assets: [{ id: 1, name: `X-${version}.zip`, size: 10 }], ...over });
const entry = (id, over = {}) => ({ addon: addon(id), state: "ok", release: release(), files: [{ id: 1, name: "X-0.3.0.zip" }], newSince: 0, ...over });

describe("addonCenterPanel centerPayload", () => {
    it("is one Components V2 message: the head, then one container per addon in its colour", () => {
        const { payload, shown, dropped } = panel.centerPayload({ entries: [entry("levelhelper"), entry("professionkit")], now: NOW });
        expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
        expect(payload.components.map((c) => c.type)).toEqual([ComponentType.Container, ComponentType.Container, ComponentType.Container]);
        expect(payload.components.map((c) => c.accent_color)).toEqual([0x8a7cff, 0x60a5fa, 0xfbbf24]);
        expect([shown, dropped]).toEqual([2, 0]);
        const [head, level] = texts(payload);
        expect(head).toBe([
            "## Addon-Downloadzentrale",
            "Klick auf **Herunterladen** – die Datei kommt nur für dich. Entpacken nach `Interface\\AddOns`.",
        ].join("\n"));
        expect(level).toBe(`### LevelHelper\nLeveling-Helfer für WoW Forever: solo oder im Duo, mit oder ohne RestedXP.\n-# Version 0.3.0 · 12.10.2026 · [Patchnotes](${webUrl("/addon")}#addon-levelhelper)`);
        expect(head).not.toMatch(/gemeldet|abonnier/i);
        expect(buttons(payload).map((b) => [b.label, b.custom_id, b.style])).toEqual([
            ["Herunterladen", "addonhub:dl:levelhelper", ButtonStyle.Success],
            ["Herunterladen", "addonhub:dl:professionkit", ButtonStyle.Success],
        ]);
    });

    it("has no subscribe button and no promise of announcements", () => {
        const { payload } = panel.centerPayload({ entries: [entry("aurakit")], now: NOW });
        expect(buttons(payload).map((b) => b.custom_id)).toEqual(["addonhub:dl:aurakit"]);
        expect(payload.components[0].components[0].type).toBe(ComponentType.TextDisplay);
        expect(JSON.stringify(payload)).not.toMatch(/addonhub:(sub|unsub)|gemeldet|abonnier/i);
    });

    it("links the patch notes of each addon with a release to its card on the web page, not to GitHub", () => {
        const { payload } = panel.centerPayload({ entries: [entry("levelhelper"), entry("aurakit", { state: "no_release", release: null, files: [] })], now: NOW });
        const [, level, aura] = texts(payload);
        expect(level).toContain(`[Patchnotes](${webUrl("/addon")}#addon-levelhelper)`);
        expect(aura).not.toContain("Patchnotes");
        expect(panel.patchNotesUrl("levelhelper")).toBe(`${webUrl("/addon")}#addon-levelhelper`);
        expect(JSON.stringify(payload)).not.toContain("github.com");
    });

    it("marks an addon NEU for seven days after its new version", () => {
        const fresh = panel.centerPayload({ entries: [entry("macrohelper", { newSince: NOW - 6 * DAY })], now: NOW }).payload;
        expect(texts(fresh)[1]).toMatch(/^### MacroHelper `NEU`\n/);
        const old = panel.centerPayload({ entries: [entry("macrohelper", { newSince: NOW - 7 * DAY })], now: NOW }).payload;
        expect(texts(old)[1]).toMatch(/^### MacroHelper\n/);
        expect(panel.isNew(0, NOW)).toBe(false);
    });

    it("shows a short note instead of the button when there is no release or GitHub fails", () => {
        const { payload } = panel.centerPayload({
            entries: [
                entry("levelhelper", { state: "no_release", release: null, files: [] }),
                entry("professionkit", { state: "error", release: null, files: [] }),
                entry("aurakit", { files: [] }),
            ],
            now: NOW,
        });
        expect(buttons(payload)).toEqual([]);
        expect(texts(payload).slice(1).map((t) => t.split("\n").pop())).toEqual([
            "-# Noch kein Release.",
            "-# Gerade nicht verfügbar.",
            `-# Version 0.3.0 · 12.10.2026 · Das neueste Release hat keine passende Datei. · [Patchnotes](${webUrl("/addon")}#addon-aurakit)`,
        ]);
    });

    it("says so when the channel's version has no addons", () => {
        const { payload, shown } = panel.centerPayload({ entries: [], now: NOW });
        expect(shown).toBe(0);
        expect(texts(payload)[1]).toBe("Für die Spielversion dieses Kanals gibt es keine Addons.");
    });

    it("names the game version in the empty state when it is known", () => {
        const { payload } = panel.centerPayload({ entries: [], now: NOW, versionLabel: "TBC Anniversary" });
        expect(texts(payload)[1]).toBe("Für TBC Anniversary gibt es hier keine Addons.");
    });

    it("stays within 40 components: the addons that do not fit are left out with a line in the head", () => {
        const many = Array.from({ length: 12 }, (_, i) => entry(`addon${i}`));
        const { payload, shown, dropped } = panel.centerPayload({ entries: many, now: NOW });
        expect(all(payload.components).length).toBeLessThanOrEqual(40);
        expect(shown + dropped).toBe(12);
        expect(dropped).toBe(3);
        expect(texts(payload)[0]).toContain("-# 3 weitere Addons stehen auf der Download-Seite.");
    });

    it("keeps all text under 4000 characters and escapes names and descriptions", () => {
        const long = Array.from({ length: 8 }, (_, i) => entry(`a${i}`, { addon: addon(`a${i}`, { name: `*Name ${i}*`, description: "x".repeat(300) }) }));
        const { payload } = panel.centerPayload({ entries: long, now: NOW });
        expect(texts(payload).join("").length).toBeLessThanOrEqual(4000);
        expect(texts(payload)[1]).toMatch(/^### \\\*Name 0\\\*/);
    });

    it("writes English for an English server", () => {
        const { payload } = panel.centerPayload({ entries: [entry("levelhelper", { newSince: NOW })], lang: "en", now: NOW });
        expect(texts(payload)[0]).toMatch(/^## Addon download centre\n/);
        expect(texts(payload)[1]).toContain("`NEW`");
        expect(buttons(payload).map((b) => b.label)).toEqual(["Download"]);
        expect(texts(payload)[1]).toContain("[Patch notes](");
    });

    it("draws the addon's application emoji when the bot has one", () => {
        const { payload } = panel.centerPayload({ entries: [entry("levelhelper")], emojis: { eh_addon_levelhelper: { id: "99", name: "eh_addon_levelhelper" } }, now: NOW });
        expect(texts(payload)[1]).toMatch(/^### <:eh_addon_levelhelper:99> LevelHelper/);
    });
});

describe("addonCenterPanel helpers", () => {
    it("gives every addon a fixed colour, the own ones those of the design", () => {
        expect(panel.addonColor("levelhelper")).toBe(0x60a5fa);
        expect(panel.addonColor("macrohelper")).toBe(0x2dd4bf);
        expect(panel.addonColor("someaddon")).toBe(panel.addonColor("someaddon"));
        expect(Number.isInteger(panel.addonColor("someaddon"))).toBe(true);
    });

    it("reads the customIds of its buttons", () => {
        expect(panel.parseCenterId(panel.downloadId("levelhelper"))).toEqual({ action: "dl", addonId: "levelhelper", assetId: "" });
        expect(panel.parseCenterId(panel.fileId("eventhelper-sync", 42))).toEqual({ action: "file", addonId: "eventhelper-sync", assetId: "42" });
    });

    it("writes dates as dd.MM.yyyy in the server's zone", () => {
        expect(panel.dateText("2026-10-12T23:30:00Z")).toBe("13.10.2026");
        expect(panel.dateText("")).toBe("");
    });
});

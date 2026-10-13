// The addon download centre's store (src/stores/addonCenterStore.js): settings,
// the posted centre, the known versions and the posted update messages.
const store = require("../../src/stores/addonCenterStore");
const { tempStoreFile } = require("../helpers/tempStore");
const fs = require("fs");

let file;
beforeEach(() => {
    file = tempStoreFile("addon-center.json");
    store.useFile(file);
});
afterAll(() => store.useFile(null));

describe("stores/addonCenterStore", () => {
    it("starts empty: no channel, no role, announcing on, nothing posted", () => {
        expect(store.getSettings()).toEqual({ channelId: "", roleId: "", announce: true });
        expect(store.getCenter()).toBeNull();
        expect(store.getCheckedAt()).toBe(0);
        expect(store.getSeen()).toEqual({});
        expect(store.listUpdates()).toEqual([]);
    });

    it("saves only the settings it gets and refuses an id that is no Discord id", () => {
        expect(store.setSettings({ channelId: "123456789012345678" })).toEqual({ settings: { channelId: "123456789012345678", roleId: "", announce: true } });
        expect(store.setSettings({ roleId: "223456789012345678", announce: false }).settings).toEqual({ channelId: "123456789012345678", roleId: "223456789012345678", announce: false });
        expect(store.setSettings({ channelId: "#general" })).toEqual({ error: "Ungültiger Kanal." });
        expect(store.setSettings({ roleId: "abc" })).toEqual({ error: "Ungültige Rolle." });
        expect(store.setSettings({ roleId: "" }).settings.roleId).toBe("");
        expect(store.getSettings().channelId).toBe("123456789012345678");
    });

    it("remembers the centre, its fingerprint and forgets it again", () => {
        expect(store.markCenterDrawn("x")).toBe(false);
        const center = store.setCenter({ guildId: "g", channelId: "c", messageId: "m", url: "https://discord.com/channels/g/c/m", postedBy: "1", hash: "h1" }, { now: 50 });
        expect(center).toEqual({ guildId: "g", channelId: "c", messageId: "m", url: "https://discord.com/channels/g/c/m", postedAt: 50, postedBy: "1", hash: "h1" });
        expect(store.markCenterDrawn("h2")).toBe(true);
        expect(store.getCenter().hash).toBe("h2");
        expect(store.clearCenter()).toMatchObject({ messageId: "m" });
        expect(store.clearCenter()).toBeNull();
        expect(store.setCenter({ channelId: "c" })).toBeNull();
    });

    it("keeps the known versions per addon and the last check", () => {
        expect(store.setSeen("levelhelper", { version: "0.3.0", previous: "0.2.0", newSince: 10 })).toEqual({ version: "0.3.0", previous: "0.2.0", newSince: 10, notifiedAt: 0 });
        expect(store.setSeen("x", { version: "" })).toBeNull();
        expect(store.getSeen()).toEqual({ levelhelper: { version: "0.3.0", previous: "0.2.0", newSince: 10, notifiedAt: 0 } });
        store.setCheckedAt(77);
        expect(store.getCheckedAt()).toBe(77);
    });

    it("lists the posted update messages, at most MAX_UPDATES of them", () => {
        for (let i = 0; i < store.MAX_UPDATES + 3; i += 1) store.addUpdate({ addonId: "a", version: `1.${i}`, channelId: "c", messageId: `m${i}` }, { now: i + 1 });
        const list = store.listUpdates();
        expect(list).toHaveLength(store.MAX_UPDATES);
        expect(list[list.length - 1]).toEqual({ addonId: "a", version: `1.${store.MAX_UPDATES + 2}`, guildId: "", channelId: "c", messageId: `m${store.MAX_UPDATES + 2}`, postedAt: store.MAX_UPDATES + 3 });
    });

    it("reads a damaged file as its defaults and drops broken entries", () => {
        fs.writeFileSync(file, JSON.stringify({ channelId: "nope", announce: false, center: { channelId: "c" }, seen: { a: { version: "1" }, b: null, c: { version: "" } }, updates: [{ addonId: "a" }, null] }));
        store.useFile(file);
        expect(store.getSettings()).toEqual({ channelId: "", roleId: "", announce: false });
        expect(store.getCenter()).toBeNull();
        expect(Object.keys(store.getSeen())).toEqual(["a"]);
        expect(store.listUpdates()).toEqual([]);
    });
});

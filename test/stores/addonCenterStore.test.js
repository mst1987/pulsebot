// The addon download centre's store (src/stores/addonCenterStore.js): settings,
// the posted centre and the known versions (update messages are gone).
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
    it("starts empty: no channel, nothing posted", () => {
        expect(store.getSettings()).toEqual({ channelId: "", versionId: "" });
        expect(store.getCenter()).toBeNull();
        expect(store.getCheckedAt()).toBe(0);
        expect(store.getSeen()).toEqual({});
    });

    it("saves only the settings it gets and refuses a channel that is no Discord id; the old role/announce keys do nothing", () => {
        expect(store.setSettings({ channelId: "123456789012345678" })).toEqual({ settings: { channelId: "123456789012345678", versionId: "" } });
        expect(store.setSettings({ roleId: "223456789012345678", announce: false }).settings).toEqual({ channelId: "123456789012345678", versionId: "" });
        expect(store.setSettings({ channelId: "#general" })).toEqual({ error: "Ungültiger Kanal." });
        expect(store.setSettings({ roleId: "abc" }).error).toBeUndefined();
        expect(store.getSettings().channelId).toBe("123456789012345678");
    });

    it("keeps the game version: \"\" = automatic, a known id is saved, an unknown one refused; old data and junk count as automatic", () => {
        expect(store.setSettings({ versionId: "tbc" }).settings.versionId).toBe("tbc");
        expect(store.getSettings().versionId).toBe("tbc");
        expect(store.setSettings({ versionId: "nope" })).toEqual({ error: "Ungültige Spielversion." });
        expect(store.getSettings().versionId).toBe("tbc");
        expect(store.setSettings({ channelId: "123456789012345678" }).settings.versionId).toBe("tbc");
        expect(store.setSettings({ versionId: "" }).settings.versionId).toBe("");
        fs.writeFileSync(file, JSON.stringify({ channelId: "123456789012345678", versionId: "forever" }));
        store.useFile(file);
        expect(store.getSettings().versionId).toBe("forever");
        fs.writeFileSync(file, JSON.stringify({ channelId: "123456789012345678" }));
        store.useFile(file);
        expect(store.getSettings().versionId).toBe("");
        fs.writeFileSync(file, JSON.stringify({ versionId: "gone" }));
        store.useFile(file);
        expect(store.getSettings().versionId).toBe("");
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

    it("drops the old keys (roleId, announce, updates) on the next write", () => {
        fs.writeFileSync(file, JSON.stringify({ channelId: "123456789012345678", roleId: "223456789012345678", announce: true, updates: [{ addonId: "a", messageId: "m" }] }));
        store.useFile(file);
        expect(store.getSettings()).toEqual({ channelId: "123456789012345678", versionId: "" });
        store.setCheckedAt(5);
        expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ channelId: "123456789012345678", versionId: "", center: null, checkedAt: 5, seen: {} });
    });

    it("reads a damaged file as its defaults and drops broken entries", () => {
        fs.writeFileSync(file, JSON.stringify({ channelId: "nope", announce: false, center: { channelId: "c" }, seen: { a: { version: "1" }, b: null, c: { version: "" } } }));
        store.useFile(file);
        expect(store.getSettings()).toEqual({ channelId: "", versionId: "" });
        expect(store.getCenter()).toBeNull();
        expect(Object.keys(store.getSeen())).toEqual(["a"]);
    });
});

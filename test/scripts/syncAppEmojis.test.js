// scripts/sync-app-emojis.js (#287): legt nur fehlende App-Emojis an, --dry-run
// ändert nichts. Kein Aufruf geht an Discord oder zamimg — REST und fetch sind Doubles.
const { parseArgs, syncAppEmojis, downloadIcon } = require("../../scripts/sync-app-emojis");

const routes = { applicationEmojis: (app) => `/applications/${app}/emojis` };
const catalog = [
    { name: "eh_role_tank", icon: "a", url: "https://icons/a.jpg" },
    { name: "eh_role_healer", icon: "b", url: "https://icons/b.jpg" },
    { name: "eh_role_melee", icon: "c", url: "https://icons/c.jpg" },
];
const okFetch = jest.fn(async () => ({
    ok: true,
    arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    headers: { get: () => "image/jpeg" },
}));
const restWith = (items) => ({ get: jest.fn(async () => ({ items })), post: jest.fn(async () => ({})) });

describe("scripts/sync-app-emojis", () => {
    beforeEach(() => okFetch.mockClear());

    it("reads its flags", () => {
        expect(parseArgs(["--dev", "--dry-run"])).toEqual({ dev: true, dryRun: true });
        expect(parseArgs([])).toEqual({ dev: false, dryRun: false });
    });

    it("only lists the missing emojis on a dry run", async () => {
        const rest = restWith([{ id: "1", name: "eh_role_tank" }]);
        const log = jest.fn();
        const out = await syncAppEmojis({ rest, routes, clientId: "app", catalog, dryRun: true, fetchImpl: okFetch, log });
        expect(rest.get).toHaveBeenCalledWith("/applications/app/emojis");
        expect(out).toEqual({ existing: 1, missing: ["eh_role_healer", "eh_role_melee"], created: [], failed: [] });
        expect(rest.post).not.toHaveBeenCalled();
        expect(okFetch).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith("3 Emojis im Katalog, 1 vorhanden, 2 fehlen.");
    });

    it("creates only what is missing, as a data uri, and reports failures", async () => {
        const rest = restWith([{ id: "1", name: "eh_role_tank" }]);
        rest.post.mockImplementation(async (route, { body }) => {
            if (body.name === "eh_role_melee") throw new Error("Maximum number of emojis reached");
            return { id: "2", name: body.name };
        });
        const out = await syncAppEmojis({ rest, routes, clientId: "app", catalog, fetchImpl: okFetch, log: () => {} });
        expect(rest.post).toHaveBeenCalledTimes(2);
        expect(rest.post).toHaveBeenCalledWith("/applications/app/emojis", { body: { name: "eh_role_healer", image: "data:image/jpeg;base64,AQID" } });
        expect(out.created).toEqual(["eh_role_healer"]);
        expect(out.failed).toEqual([{ name: "eh_role_melee", error: "Maximum number of emojis reached" }]);
    });

    it("does nothing when every emoji exists", async () => {
        const rest = restWith(catalog.map((e, i) => ({ id: String(i), name: e.name })));
        const out = await syncAppEmojis({ rest, routes, clientId: "app", catalog, fetchImpl: okFetch, log: () => {} });
        expect(out).toMatchObject({ existing: 3, missing: [], created: [] });
        expect(rest.post).not.toHaveBeenCalled();
    });

    it("refuses an icon that is missing or too large", async () => {
        await expect(downloadIcon("u", async () => ({ ok: false, status: 404 }))).rejects.toThrow("HTTP 404");
        const big = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(300 * 1024), headers: { get: () => null } });
        await expect(downloadIcon("u", big)).rejects.toThrow("zu groß");
    });

    it("uploads a catalogue entry with a local file from disk, without asking the web", async () => {
        const { readIconFile } = require("../../src/services/discord/appEmojiSync");
        const rest = restWith([]);
        const readFile = jest.fn(async () => Buffer.from([4, 5, 6]));
        const local = [{ name: "eh_ui_leader", icon: "leader", file: "/assets/emojis/eh_ui_leader.png" }];
        const out = await syncAppEmojis({ rest, routes, clientId: "app", catalog: local, fetchImpl: okFetch, readFile, log: () => {} });
        expect(out.created).toEqual(["eh_ui_leader"]);
        expect(readFile).toHaveBeenCalledWith("/assets/emojis/eh_ui_leader.png");
        expect(okFetch).not.toHaveBeenCalled();
        expect(rest.post).toHaveBeenCalledWith("/applications/app/emojis", { body: { name: "eh_ui_leader", image: "data:image/png;base64,BAUG" } });
        await expect(readIconFile("x.svg", readFile)).rejects.toThrow("unbekanntes Bildformat");
        await expect(readIconFile("x.png", async () => Buffer.alloc(300 * 1024))).rejects.toThrow("zu groß");
        // the real checked-in file reads as a PNG data uri
        const { uiIconFile } = require("../../src/services/discord/appEmojis");
        await expect(readIconFile(uiIconFile("signed"))).resolves.toMatch(/^data:image\/png;base64,iVBOR/);
    });
});

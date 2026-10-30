// The raid plan library per server (#945): every library write names the server this tab loaded the library of,
// and a server switch in another tab comes back as plain words instead of an error code.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../client";
import {
    createRaidplanProfile, createRaidplanTemplate, deleteRaidplanMap, deleteRaidplanProfile, deleteRaidplanTemplate,
    duplicateRaidplanTemplate, getRaidplan, getRaidplanProfiles, getRaidplanTemplates, raidplanLibraryServer,
    updateRaidplanProfile, updateRaidplanTemplate, uploadRaidplanMap,
} from "../raidplan";
import { t } from "../../i18n";

vi.mock("../client", async (orig) => ({
    ...(await orig<typeof import("../client")>()),
    get: vi.fn(),
    send: vi.fn(),
    sendRaw: vi.fn(),
}));

const A = "500000000000000001";
const B = "500000000000000002";

beforeEach(() => {
    vi.mocked(client.get).mockReset();
    vi.mocked(client.send).mockReset().mockResolvedValue({});
    vi.mocked(client.sendRaw).mockReset().mockResolvedValue({ key: "k" });
});

const lastBody = () => vi.mocked(client.send).mock.calls.at(-1)?.[2] as Record<string, unknown>;

describe("raid plan library per server", () => {
    it("remembers the server of the templates and names it in every template write", async () => {
        vi.mocked(client.get).mockResolvedValue({ guildId: A, templates: [] });
        await getRaidplanTemplates();
        expect(raidplanLibraryServer()).toBe(A);

        await createRaidplanTemplate({ name: "BT" } as never);
        expect(lastBody()).toEqual(expect.objectContaining({ name: "BT", libraryGuildId: A }));
        await updateRaidplanTemplate("t1", { name: "BT 2" } as never);
        expect(lastBody()).toEqual(expect.objectContaining({ id: "t1", libraryGuildId: A }));
        await duplicateRaidplanTemplate("t1");
        expect(lastBody()).toEqual({ id: "t1", libraryGuildId: A });
        await deleteRaidplanTemplate("t1");
        expect(lastBody()).toEqual({ id: "t1", libraryGuildId: A });
    });

    it("takes the server of the profiles and of the editor view", async () => {
        vi.mocked(client.get).mockResolvedValue({ guildId: B, profiles: [], categories: [] });
        await getRaidplanProfiles();
        await createRaidplanProfile({ name: "Tanks" } as never);
        expect(lastBody()).toEqual(expect.objectContaining({ name: "Tanks", libraryGuildId: B }));

        vi.mocked(client.get).mockResolvedValue({ libraryGuildId: A, profiles: [], templates: [] });
        await getRaidplan("eh-1");
        await updateRaidplanProfile("p1", { name: "Heiler" } as never);
        expect(lastBody()).toEqual(expect.objectContaining({ id: "p1", libraryGuildId: A }));
        await deleteRaidplanProfile("p1");
        expect(lastBody()).toEqual({ id: "p1", libraryGuildId: A });
    });

    it("names the server for a template's room map only", async () => {
        vi.mocked(client.get).mockResolvedValue({ guildId: A, templates: [] });
        await getRaidplanTemplates();
        const file = new File(["x"], "map.png", { type: "image/png" });

        await uploadRaidplanMap("t/abc/bt/supremus", file);
        expect(vi.mocked(client.sendRaw).mock.calls[0][1]).toBe(`/api/raidplan/map?key=${encodeURIComponent("t/abc/bt/supremus")}&libraryGuildId=${A}`);
        await uploadRaidplanMap("eh-1/bt/supremus", file);
        expect(vi.mocked(client.sendRaw).mock.calls[1][1]).toBe(`/api/raidplan/map?key=${encodeURIComponent("eh-1/bt/supremus")}`);

        await deleteRaidplanMap("t/abc/bt/supremus");
        expect(lastBody()).toEqual({ key: "t/abc/bt/supremus", libraryGuildId: A });
        await deleteRaidplanMap("eh-1/bt/supremus");
        expect(lastBody()).toEqual({ key: "eh-1/bt/supremus" });
    });

    it("says a server switch in plain words and passes other errors on", async () => {
        vi.mocked(client.send).mockRejectedValueOnce({ code: "server_switched", message: "server_switched" });
        await expect(updateRaidplanTemplate("t1", { name: "x" } as never)).rejects.toEqual({ code: "server_switched", message: t("settings.serverSwitched") });

        vi.mocked(client.sendRaw).mockRejectedValueOnce({ code: "server_switched", message: "server_switched" });
        await expect(uploadRaidplanMap("t/abc/bt/supremus", new File(["x"], "m.png"))).rejects.toEqual(expect.objectContaining({ message: t("settings.serverSwitched") }));

        vi.mocked(client.send).mockRejectedValueOnce({ code: "not_found", message: "Nicht gefunden" });
        await expect(deleteRaidplanProfile("p1")).rejects.toEqual({ code: "not_found", message: "Nicht gefunden" });
    });
});

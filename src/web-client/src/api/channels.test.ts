// The client's side of the channel endpoints (#259, #285): which request each
// function sends, and that the server serves every one of them.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "./client";
import {
    archiveChannels, createChannel, deleteChannels, duplicateChannel, getChannels, patchChannels, quickCreateChannels,
    renamePreview, saveChannelConfig, saveChannelPurpose, saveChannelSchema, type ChannelPurpose,
} from "./channels";
import { getChannelNameSuggestion } from "./raids";
import { requireBackend } from "../test/backend";

vi.mock("./client", async (orig) => ({
    ...(await orig<typeof import("./client")>()),
    get: vi.fn(),
    send: vi.fn(),
}));

beforeEach(() => {
    vi.mocked(client.get).mockResolvedValue({});
    vi.mocked(client.send).mockResolvedValue({});
});

const purpose = (over: Partial<ChannelPurpose>): ChannelPurpose => ({
    id: "p", label: "Zweck", icon: "inv_misc_note_02", key: "logChannelIds", kind: "channel", multiple: false, need: "send",
    section: "raids", hint: "", ids: [], items: [], status: { tone: "", label: "", tip: "" }, ...over,
});

/** "METHOD /path" of every route the server serves. */
function serverRoutes(): string[] {
    const { routes } = requireBackend("web/apiRoutes/channels");
    const list = Array.isArray(routes) ? routes : Object.values(routes);
    return list.map((r: { method: string; path: string }) => `${r.method} ${r.path}`);
}

describe("channel api", () => {
    it("sends each change to its endpoint", async () => {
        await getChannels();
        expect(client.get).toHaveBeenCalledWith("/api/channels");

        await patchChannels(["a"], { name: "neu" });
        expect(client.send).toHaveBeenLastCalledWith("PATCH", "/api/channels", { ids: ["a"], changes: { name: "neu" } });
        await archiveChannels(["a"]);
        expect(client.send).toHaveBeenLastCalledWith("POST", "/api/channels/archive", { ids: ["a"] });
        await renamePreview({ ids: ["a"], schema: "{tag}", raid: "" });
        expect(client.send).toHaveBeenLastCalledWith("POST", "/api/channels/rename-preview", { ids: ["a"], schema: "{tag}", raid: "" });
        const input = { categoryId: "c", schema: "", raid: "", from: "2026-09-24", count: 1, interval: "once" as const, templateChannelId: "", dryRun: true };
        await quickCreateChannels(input);
        expect(client.send).toHaveBeenLastCalledWith("POST", "/api/channels/batch", input);
        await saveChannelSchema({ categoryId: "c", schema: "", raid: "", templateChannelId: "" });
        expect(client.send).toHaveBeenLastCalledWith("POST", "/api/channels/schema", { categoryId: "c", schema: "", raid: "", templateChannelId: "" });
        await saveChannelConfig({ archiveDeleteHintDays: 7 });
        expect(client.send).toHaveBeenLastCalledWith("POST", "/api/channels/config", { archiveDeleteHintDays: 7 });
        await createChannel({ name: "x", type: "text", parentId: "" });
        expect(client.send).toHaveBeenLastCalledWith("POST", "/api/channels", { name: "x", type: "text", parentId: "" });
        await duplicateChannel({ channelId: "a", name: "a-2" });
        expect(client.send).toHaveBeenLastCalledWith("POST", "/api/channels/duplicate", { channelId: "a", name: "a-2" });
    });

    it("deletes from the archive by default and anywhere only when asked", async () => {
        await deleteChannels(["a"], "a");
        expect(client.send).toHaveBeenLastCalledWith("POST", "/api/channels/delete", { ids: ["a"], confirm: "a" });
        await deleteChannels(["a", "b"], "LOESCHEN", true);
        expect(client.send).toHaveBeenLastCalledWith("POST", "/api/channels/delete", { ids: ["a", "b"], confirm: "LOESCHEN", anywhere: true });
    });

    it("calls every endpoint the server serves, and only those", async () => {
        const served = serverRoutes();
        const called: string[] = [];
        for (const call of [
            () => getChannels(), () => patchChannels([], {}), () => archiveChannels([]), () => deleteChannels([], ""),
            () => renamePreview({ ids: [], schema: "", raid: "" }), () => saveChannelSchema({ categoryId: "", schema: "", raid: "", templateChannelId: "" }),
            () => saveChannelConfig({}), () => createChannel({ name: "", type: "", parentId: "" }), () => duplicateChannel({ channelId: "", name: "" }),
            () => quickCreateChannels({ categoryId: "", schema: "", raid: "", from: "", count: 1, interval: "once", templateChannelId: "" }),
        ]) {
            vi.mocked(client.get).mockClear();
            vi.mocked(client.send).mockClear();
            await call();
            const sent = vi.mocked(client.send).mock.calls[0];
            const got = vi.mocked(client.get).mock.calls[0];
            const key = sent ? `${sent[0]} ${sent[1]}` : `GET ${got[0]}`;
            called.push(key);
        }
        expect([...called].sort()).toEqual([...served].sort());
    });
});

describe("purposes are settings", () => {
    it("stores a purpose under its config key through PATCH /api/settings, without duplicates", async () => {
        await saveChannelPurpose(purpose({ key: "logChannelIds", multiple: true }), ["a", "b", "a", ""]);
        expect(client.send).toHaveBeenLastCalledWith("PATCH", "/api/settings", { logChannelIds: ["a", "b"] });
        await saveChannelPurpose(purpose({ key: "applicationChannelId" }), []);
        expect(client.send).toHaveBeenLastCalledWith("PATCH", "/api/settings", { applicationChannelId: "" });
    });

    it("nests the signup channel under raidDefaults, the key the server names", async () => {
        await saveChannelPurpose(purpose({ key: "raidDefaults.channelId" }), ["c1"]);
        expect(client.send).toHaveBeenLastCalledWith("PATCH", "/api/settings", { raidDefaults: { channelId: "c1" } });
        const { PURPOSES } = requireBackend("web/channelPurposes");
        expect(PURPOSES.map((p: { key: string }) => p.key)).toContain("raidDefaults.channelId");
    });
});

describe("the create dialog's channel name suggestion (#285)", () => {
    it("asks the server with category, date and instances", async () => {
        await getChannelNameSuggestion({ categoryId: "c1", date: "2026-09-24", instanceIds: ["ssc", "tk"], sourceEventId: "e1" });
        const url = new URL(vi.mocked(client.get).mock.calls[0][0] as string, "http://x");
        expect(url.pathname).toBe("/api/raids/channel-name");
        expect(Object.fromEntries(url.searchParams)).toEqual({ categoryId: "c1", date: "2026-09-24", instanceIds: "ssc,tk", sourceEventId: "e1" });
    });

    it("is guarded as part of the raids area", () => {
        const { AREA_BY_PATH } = requireBackend("web/apiAccess");
        expect(AREA_BY_PATH["/api/raids/channel-name"]).toBe("raids");
    });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../client";
import { t } from "../../../i18n";
import { deleteRaidTemplate, getRaidTemplates, importRaidTemplates, saveRaidTemplate, type RaidTemplateInput } from "../raidTemplates";

vi.mock("../../client", async (orig) => ({
    ...(await orig<typeof import("../../client")>()),
    get: vi.fn(),
    send: vi.fn(),
}));

const A = "111111111111111111";
const B = "222222222222222222";
const draft = { name: "Kara" } as RaidTemplateInput;
const lastCall = () => vi.mocked(client.send).mock.calls.at(-1);

beforeEach(async () => {
    vi.mocked(client.get).mockReset().mockResolvedValue({ guildId: A, templates: [], categoryNames: {} });
    vi.mocked(client.send).mockReset().mockResolvedValue({});
    await getRaidTemplates();
});

describe("raid templates are written to the server the tab loaded (#1076)", () => {
    it("names that server on every write", async () => {
        await saveRaidTemplate(draft);
        expect(lastCall()).toEqual(["POST", "/api/raid-templates", { name: "Kara", libraryGuildId: A }]);

        await saveRaidTemplate({ ...draft, id: "t1" });
        expect(lastCall()).toEqual(["PATCH", "/api/raid-templates", { name: "Kara", id: "t1", libraryGuildId: A }]);

        await deleteRaidTemplate("t1");
        expect(lastCall()).toEqual(["DELETE", "/api/raid-templates", { id: "t1", libraryGuildId: A }]);

        await importRaidTemplates();
        expect(lastCall()).toEqual(["POST", "/api/raid-templates/import", { libraryGuildId: A }]);
    });

    it("follows the last answer, and a caller's own server wins", async () => {
        vi.mocked(client.get).mockResolvedValue({ guildId: B, templates: [], categoryNames: {} });
        await getRaidTemplates();
        await deleteRaidTemplate("t1");
        expect(lastCall()?.[2]).toEqual({ id: "t1", libraryGuildId: B });

        await saveRaidTemplate(draft, A);
        expect(lastCall()?.[2]).toEqual({ name: "Kara", libraryGuildId: A });
    });

    it("says a server switch in plain words and leaves other errors alone", async () => {
        vi.mocked(client.send).mockRejectedValueOnce({ code: "server_switched", message: "x" });
        await expect(saveRaidTemplate(draft)).rejects.toEqual({ code: "server_switched", message: t("settings.serverSwitched") });

        const other = { code: "template_in_use", message: "Standard" };
        vi.mocked(client.send).mockRejectedValueOnce(other);
        await expect(deleteRaidTemplate("t1")).rejects.toEqual(other);
    });
});

jest.mock("axios");
const axios = require("axios");
const softres = require("../../src/utils/softres");

afterEach(() => jest.clearAllMocks());

// A softres.it session always starts with a GET of the start page for the
// session + XSRF cookies; every helper below wires that up first.
function mockSession(cookies = ["XSRF-TOKEN=tok%3D%3D; path=/", "softres_session_v2=sess; path=/"]) {
    axios.get.mockResolvedValue({ headers: { "set-cookie": cookies } });
}

function mockCreated(location = "https://softres.it/raid/Le3KEOe6?adminToken=f637dc") {
    axios.request.mockResolvedValue({ status: 302, headers: { location } });
}

describe("utils/softres", () => {
    describe("parseInstancesFromTitle", () => {
        it("derives TBC instances from a compound title", () => {
            expect(softres.parseInstancesFromTitle("Kara + Gruul").map((i) => i.code)).toEqual(["kara", "gruul"]);
            expect(softres.parseInstancesFromTitle("SSC/TK Progress").map((i) => i.code)).toEqual(["ssc", "tempestkeep"]);
            expect(softres.parseInstancesFromTitle("BT & Hyjal").map((i) => i.code)).toEqual(["blacktemple", "hyjal"]);
        });

        it("matches classic raids and keeps a single edition", () => {
            expect(softres.parseInstancesFromTitle("MC BWL Ony", "classic").map((i) => i.code)).toEqual(["mc", "bwl", "onyxia"]);
        });

        it("does not false-match abbreviations inside longer words", () => {
            // "mc" must not match inside "Mechanar"
            expect(softres.parseInstancesFromTitle("Mechanar Heroic")).toEqual([]);
        });

        it("returns [] for an empty or unknown title", () => {
            expect(softres.parseInstancesFromTitle("")).toEqual([]);
            expect(softres.parseInstancesFromTitle("Random Dungeon Night")).toEqual([]);
        });

        it("restricts to a single edition when a preference is given", () => {
            const out = softres.parseInstancesFromTitle("Naxx run", "classic");
            expect(out.every((i) => i.edition === "classic")).toBe(true);
        });
    });

    describe("instancesForEdition", () => {
        it("no longer lists the combined dungeons — multi-select checkboxes cover that", () => {
            const codes = softres.instancesForEdition("tbc").map((i) => i.code);
            expect(codes).not.toContain("gruulmag");
            expect(codes).not.toContain("ssctempestkeep");
            expect(codes).not.toContain("bthyjal");
            // the standalone instances are still there individually
            expect(codes).toEqual(expect.arrayContaining(["gruul", "magtheridon", "ssc", "tempestkeep", "blacktemple", "hyjal"]));
        });

        it("drops the combined world-boss entry softres.it removed in the rewrite", () => {
            expect(softres.instancesForEdition("tbc").map((i) => i.code)).not.toContain("worldbosses");
        });
    });

    describe("editionOf / nameOf", () => {
        it("resolves known codes", () => {
            expect(softres.editionOf("kara")).toBe("tbc");
            expect(softres.editionOf("mc")).toBe("classic");
            expect(softres.nameOf("kara")).toBe("Karazhan");
        });
        it("degrades gracefully for unknown codes", () => {
            expect(softres.editionOf("nope")).toBe("");
            expect(softres.nameOf("nope")).toBe("nope");
        });
        it("uses the short form for the long-named TBC raids", () => {
            expect(softres.nameOf("ssc")).toBe("SSC");
            expect(softres.nameOf("tempestkeep")).toBe("TK");
        });
    });

    describe("targetSizeForInstances", () => {
        it("takes the largest slot count among the chosen instances, not the sum", () => {
            expect(softres.targetSizeForInstances(["gruul", "magtheridon"])).toBe(25);
            expect(softres.targetSizeForInstances(["kara"])).toBe(10);
        });
        it("ignores unknown codes and returns 0 when nothing is known", () => {
            expect(softres.targetSizeForInstances(["nope"])).toBe(0);
            expect(softres.targetSizeForInstances([])).toBe(0);
            expect(softres.targetSizeForInstances()).toBe(0);
        });
    });

    describe("instanceIdsForCodes", () => {
        it("maps our codes to softres.it's numeric instance ids", () => {
            expect(softres.instanceIdsForCodes(["ssc", "tempestkeep"])).toEqual([29, 30]);
            expect(softres.instanceIdsForCodes(["kara"])).toEqual([25]);
        });
        it("de-duplicates and trims, keeping the given order", () => {
            expect(softres.instanceIdsForCodes([" gruul ", "kara", "gruul"])).toEqual([27, 25]);
        });
        it("rejects an unknown code instead of silently dropping the raid", () => {
            expect(() => softres.instanceIdsForCodes(["kara", "worldbosses"])).toThrow("Unbekannte Instanz: worldbosses");
        });
        it("rejects an empty list", () => {
            expect(() => softres.instanceIdsForCodes([])).toThrow("Instanz");
        });
    });

    describe("buildItemNotes / hardReserveIds", () => {
        it("keeps only hard reserves that carry a note", () => {
            expect(softres.buildItemNotes([
                { id: 28830, name: "Item" },
                { id: 12345, note: "Guild bank" },
                { id: 0, note: "ignored" },
            ])).toEqual([{ id: 12345, note: "Guild bank" }]);
        });

        it("collects the plain item ids, de-duplicated, dropping invalid ones", () => {
            expect(softres.hardReserveIds([{ id: 28830 }, { id: "12345" }, { id: 28830 }, { id: "abc" }, { id: 0 }]))
                .toEqual([28830, 12345]);
            expect(softres.hardReserveIds()).toEqual([]);
        });
    });

    describe("buildCreatePayload", () => {
        it("emits softres.it's snake_case shape with numeric instance ids", () => {
            const p = softres.buildCreatePayload({ instances: ["ssc", "tempestkeep"], edition: "tbc", amount: 2, faction: "Horde" });
            expect(p).toEqual({
                edition: "tbc",
                instances: [29, 30],
                faction: "horde",
                protection: true,
                reserve_limit: 2,
                item_limit: 0,
                item_reserve_limit: 0,
                hide_reserves: false,
                notes_enabled: true,
                class_restrictions: true,
            });
        });

        it("lower-cases the faction, as the rewritten site expects", () => {
            expect(softres.buildCreatePayload({ instances: ["kara"], faction: "Alliance" }).faction).toBe("alliance");
        });

        it("clamps amount to 1..6 and defaults it to 1", () => {
            expect(softres.buildCreatePayload({ instances: ["kara"], faction: "Horde", amount: 99 }).reserve_limit).toBe(6);
            expect(softres.buildCreatePayload({ instances: ["kara"], faction: "Horde", amount: 0 }).reserve_limit).toBe(1);
            expect(softres.buildCreatePayload({ instances: ["kara"], faction: "Horde" }).reserve_limit).toBe(1);
        });

        it("requires user protection by default and lets the caller opt out", () => {
            expect(softres.buildCreatePayload({ instances: ["kara"], faction: "Horde" }).protection).toBe(true);
            expect(softres.buildCreatePayload({ instances: ["kara"], faction: "Horde", protection: true }).protection).toBe(true);
            expect(softres.buildCreatePayload({ instances: ["kara"], faction: "Horde", protection: false }).protection).toBe(false);
        });

        it("passes hideReserves through as hide_reserves", () => {
            expect(softres.buildCreatePayload({ instances: ["kara"], faction: "Horde", hideReserves: true }).hide_reserves).toBe(true);
        });

        it("rejects an empty instance list", () => {
            expect(() => softres.buildCreatePayload({ instances: [], faction: "Alliance" })).toThrow("Instanz");
        });

        it("rejects an invalid faction", () => {
            expect(() => softres.buildCreatePayload({ instances: ["kara"], faction: "alliance" })).toThrow("Fraktion");
            expect(() => softres.buildCreatePayload({ instances: ["kara"], faction: "" })).toThrow("Fraktion");
        });
    });

    describe("parseCreatedLocation / raidUrls", () => {
        it("reads raid id and admin token out of the create redirect", () => {
            expect(softres.parseCreatedLocation("https://softres.it/raid/Le3KEOe6?adminToken=f637dc"))
                .toEqual({ raidId: "Le3KEOe6", token: "f637dc" });
            expect(softres.parseCreatedLocation("/raid/Le3KEOe6")).toEqual({ raidId: "Le3KEOe6", token: "" });
        });

        it("returns null for anything that is not a raid page", () => {
            expect(softres.parseCreatedLocation("")).toBeNull();
            expect(softres.parseCreatedLocation(null)).toBeNull();
            expect(softres.parseCreatedLocation("https://softres.it/")).toBeNull();
            expect(softres.parseCreatedLocation("https://softres.it/raid/abc/audit")).toBeNull();
        });

        it("builds the edit URL with the adminToken query the new site uses", () => {
            expect(softres.raidUrls("abc123", "sec123")).toEqual({
                url: "https://softres.it/raid/abc123",
                editUrl: "https://softres.it/raid/abc123?adminToken=sec123",
            });
            expect(softres.raidUrls("abc123", "").editUrl).toBe("https://softres.it/raid/abc123");
        });
    });

    describe("createRaid", () => {
        it("opens a session, posts to /raid and reads the ids off the redirect", async () => {
            mockSession();
            mockCreated();

            const res = await softres.createRaid({ instances: ["ssc"], edition: "tbc", amount: 2, faction: "Alliance" });

            expect(axios.get).toHaveBeenCalledWith("https://softres.it/", expect.objectContaining({ timeout: 45000 }));
            expect(axios.request).toHaveBeenCalledTimes(1);
            const call = axios.request.mock.calls[0][0];
            expect(call).toMatchObject({
                method: "post",
                url: "https://softres.it/raid",
                maxRedirects: 0,
                data: expect.objectContaining({ instances: [29], faction: "alliance", reserve_limit: 2 }),
            });
            // The XSRF cookie is URL-encoded; the header wants it decoded.
            expect(call.headers["X-XSRF-TOKEN"]).toBe("tok==");
            expect(call.headers.Cookie).toContain("softres_session_v2=sess");
            expect(res).toEqual({
                raidId: "Le3KEOe6",
                token: "f637dc",
                url: "https://softres.it/raid/Le3KEOe6",
                editUrl: "https://softres.it/raid/Le3KEOe6?adminToken=f637dc",
            });
        });

        it("treats a 302 as success and does not follow it", async () => {
            mockSession();
            mockCreated();
            await softres.createRaid({ instances: ["kara"], faction: "Horde" });
            const { validateStatus } = axios.request.mock.calls[0][0];
            expect(validateStatus(302)).toBe(true);
            expect(validateStatus(422)).toBe(false);
        });

        it("applies hard reserves as follow-up writes after claiming the token", async () => {
            mockSession();
            axios.request.mockResolvedValue({ status: 302, headers: { location: "https://softres.it/raid/R1?adminToken=t1" } });

            await softres.createRaid({
                instances: ["kara"], faction: "Horde",
                hardReserves: [{ id: 29949, name: "Arcanite Steam-Pistol" }, { id: 29922, note: "Für den Tank" }],
            });

            const calls = axios.request.mock.calls.map(([c]) => [c.method, c.url, c.data]);
            expect(calls).toEqual([
                ["post", "https://softres.it/raid", expect.any(Object)],
                ["get", "https://softres.it/raid/R1?adminToken=t1", undefined],
                ["post", "https://softres.it/raid/R1/hardReserve", { items: [29949, 29922] }],
                ["put", "https://softres.it/raid/R1", { item_notes: [{ id: 29922, note: "Für den Tank" }] }],
            ]);
        });

        it("skips the follow-up writes entirely when there is nothing to apply", async () => {
            mockSession();
            mockCreated();
            await softres.createRaid({ instances: ["kara"], faction: "Horde", hardReserves: [] });
            expect(axios.request).toHaveBeenCalledTimes(1);
        });

        it("still returns the list when only the hard reserves fail", async () => {
            mockSession();
            axios.request
                .mockResolvedValueOnce({ status: 302, headers: { location: "https://softres.it/raid/R1?adminToken=t1" } })
                .mockResolvedValueOnce({ status: 302, headers: {} })
                .mockRejectedValueOnce({ response: { status: 422, data: { errors: { items: ["One or more selected items are not available in this raid."] } } } });

            const res = await softres.createRaid({
                instances: ["kara"], faction: "Horde", hardReserves: [{ id: 12345 }],
            });

            expect(res.raidId).toBe("R1");
            expect(res.url).toBe("https://softres.it/raid/R1");
            expect(res.hardReserveError).toMatch("not available in this raid");
        });

        it("surfaces a Laravel validation error from the create call", async () => {
            mockSession();
            axios.request.mockRejectedValue({
                response: { status: 422, data: { message: "The given data was invalid.", errors: { faction: ["The faction field is required."] } } },
            });
            await expect(softres.createRaid({ instances: ["kara"], faction: "Alliance" }))
                .rejects.toThrow("The faction field is required.");
        });

        it("fails loudly when the redirect carries no raid id", async () => {
            mockSession();
            axios.request.mockResolvedValue({ status: 302, headers: { location: "https://softres.it/" } });
            await expect(softres.createRaid({ instances: ["kara"], faction: "Horde" }))
                .rejects.toThrow("keine Raid-ID");
        });

        it("fails when softres.it hands out no CSRF token", async () => {
            axios.get.mockResolvedValue({ headers: { "set-cookie": ["other=1"] } });
            await expect(softres.createRaid({ instances: ["kara"], faction: "Horde" }))
                .rejects.toThrow("CSRF-Token");
            expect(axios.request).not.toHaveBeenCalled();
        });

        it("reports an unreachable softres.it", async () => {
            axios.get.mockRejectedValue(new Error("ETIMEDOUT"));
            await expect(softres.createRaid({ instances: ["kara"], faction: "Horde" }))
                .rejects.toThrow("nicht erreichbar");
        });

        it("validates before opening a session at all", async () => {
            await expect(softres.createRaid({ instances: [], faction: "Horde" })).rejects.toThrow("Instanz");
            expect(axios.get).not.toHaveBeenCalled();
        });
    });
});

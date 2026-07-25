jest.mock("axios");

const axios = require("axios");
const Blizzard = require("../../src/classes/blizzard.js");

describe("classes/Blizzard", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("configuration", () => {
        it("is not configured without credentials", () => {
            expect(new Blizzard().isConfigured()).toBe(false);
            expect(new Blizzard({ clientId: "a" }).isConfigured()).toBe(false);
            expect(new Blizzard({ clientId: "a", clientSecret: "b" }).isConfigured()).toBe(true);
        });

        it("defaults to the Thunderstrike EU classic namespace and regional host", () => {
            const b = new Blizzard({ clientId: "a", clientSecret: "b" });
            expect(b.region).toBe("eu");
            expect(b.realmSlug).toBe("thunderstrike");
            expect(b.namespace).toBe("profile-classicann-eu");
            expect(b.apiHost).toBe("https://eu.api.blizzard.com");
        });

        it("lowercases region and realm and honours overrides", () => {
            const b = new Blizzard({ clientId: "a", clientSecret: "b", region: "US", realmSlug: "MyRealm" });
            expect(b.region).toBe("us");
            expect(b.realmSlug).toBe("myrealm");
            expect(b.namespace).toBe("profile-classicann-us");
            expect(b.apiHost).toBe("https://us.api.blizzard.com");
        });
    });

    describe("getEquipment", () => {
        function configured() {
            return new Blizzard({ clientId: "id", clientSecret: "secret" });
        }

        it("returns null without credentials (no network call)", async () => {
            const result = await new Blizzard().getEquipment("Foo");
            expect(result).toBeNull();
            expect(axios.get).not.toHaveBeenCalled();
            expect(axios.post).not.toHaveBeenCalled();
        });

        it("returns null when no character name is given", async () => {
            const result = await configured().getEquipment("");
            expect(result).toBeNull();
            expect(axios.post).not.toHaveBeenCalled();
        });

        it("fetches a token then the equipment and normalizes the items", async () => {
            axios.post.mockResolvedValue({ data: { access_token: "tok", expires_in: 3600 } });
            axios.get.mockResolvedValue({
                data: {
                    equipped_items: [
                        { slot: { type: "HEAD" }, item: { id: 29011 }, name: "Cursed Vision", quality: { type: "EPIC" }, level: { value: 120 } },
                        { slot: { type: "NECK" }, item: { id: 28530 }, name: "Adornment", quality: { type: "RARE" }, level: { value: 115 } },
                    ],
                },
            });

            const b = configured();
            const result = await b.getEquipment("Thrall");

            // token request
            expect(axios.post).toHaveBeenCalledWith(
                "https://oauth.battle.net/token",
                "grant_type=client_credentials",
                expect.objectContaining({ auth: { username: "id", password: "secret" } })
            );
            // equipment request: lowercased char + realm, classic namespace, bearer token
            const [url, cfg] = axios.get.mock.calls[0];
            expect(url).toBe("https://eu.api.blizzard.com/profile/wow/character/thunderstrike/thrall/equipment");
            expect(cfg.params).toEqual({ namespace: "profile-classicann-eu", locale: "en_GB" });
            expect(cfg.headers.Authorization).toBe("Bearer tok");

            expect(result).toEqual([
                { slot: "HEAD", itemId: 29011, name: "Cursed Vision", quality: "EPIC", level: 120, enchants: [], gems: [], emptySockets: 0 },
                { slot: "NECK", itemId: 28530, name: "Adornment", quality: "RARE", level: 115, enchants: [], gems: [], emptySockets: 0 },
            ]);
        });

        it("extracts enchants, gems and empty sockets from an item", async () => {
            axios.post.mockResolvedValue({ data: { access_token: "tok", expires_in: 3600 } });
            axios.get.mockResolvedValue({ data: { equipped_items: [{
                slot: { type: "HEAD" }, item: { id: 29011 }, name: "Helm",
                enchantments: [{ display_string: "Enchanted: +150 Mana" }],
                sockets: [
                    { socket_type: { type: "META" }, item: { name: "Chaotic Skyfire Diamond" } },
                    { socket_type: { type: "RED" } },
                ],
            }] } });
            const [item] = await configured().getEquipment("Foo");
            expect(item.enchants).toEqual(["Enchanted: +150 Mana"]);
            expect(item.gems).toEqual(["Chaotic Skyfire Diamond"]);
            expect(item.emptySockets).toBe(1);
        });

        it("caches the token across calls", async () => {
            axios.post.mockResolvedValue({ data: { access_token: "tok", expires_in: 3600 } });
            axios.get.mockResolvedValue({ data: { equipped_items: [] } });

            const b = configured();
            await b.getEquipment("A");
            await b.getEquipment("B");

            expect(axios.post).toHaveBeenCalledTimes(1); // token reused
            expect(axios.get).toHaveBeenCalledTimes(2);
        });

        it("returns null (fallback) on a 404 from the equipment endpoint", async () => {
            axios.post.mockResolvedValue({ data: { access_token: "tok", expires_in: 3600 } });
            axios.get.mockRejectedValue({ response: { status: 404 } });

            const client = configured();
            const result = await client.getEquipment("Ghost");
            expect(result).toBeNull();
            expect(client.lastError).toMatchObject({ status: 404, message: expect.any(String) });
        });

        it("records lastError reason when unconfigured or nameless, and clears it on success", async () => {
            const bare = new Blizzard();
            await bare.getEquipment("Foo");
            expect(bare.lastError).toEqual({ reason: "not_configured" });

            const c = configured();
            await c.getEquipment("");
            expect(c.lastError).toEqual({ reason: "no_name" });

            axios.post.mockResolvedValue({ data: { access_token: "t", expires_in: 3600 } });
            axios.get.mockResolvedValue({ data: { equipped_items: [] } });
            await c.getEquipment("Foo");
            expect(c.lastError).toBeNull();
        });

        it("returns null (fallback) on a 403 from the equipment endpoint", async () => {
            axios.post.mockResolvedValue({ data: { access_token: "tok", expires_in: 3600 } });
            axios.get.mockRejectedValue({ response: { status: 403 } });

            const result = await configured().getEquipment("Protected");
            expect(result).toBeNull();
        });

        it("returns null (fallback) when the token request itself fails", async () => {
            axios.post.mockRejectedValue({ response: { status: 401 } });

            const result = await configured().getEquipment("Foo");
            expect(result).toBeNull();
            expect(axios.get).not.toHaveBeenCalled();
        });

        it("honours per-call realm/region overrides", async () => {
            axios.post.mockResolvedValue({ data: { access_token: "tok", expires_in: 3600 } });
            axios.get.mockResolvedValue({ data: { equipped_items: [] } });

            await configured().getEquipment("Foo", { realmSlug: "Other", region: "us" });
            const [url, cfg] = axios.get.mock.calls[0];
            expect(url).toBe("https://us.api.blizzard.com/profile/wow/character/other/foo/equipment");
            expect(cfg.params.namespace).toBe("profile-classicann-us");
        });

        it("uses an explicitly configured namespace override", async () => {
            axios.post.mockResolvedValue({ data: { access_token: "tok", expires_in: 3600 } });
            axios.get.mockResolvedValue({ data: { equipped_items: [] } });

            const c = new Blizzard({ clientId: "id", clientSecret: "s", namespace: "profile-classicann-eu" });
            await c.getEquipment("Foo");
            expect(axios.get.mock.calls[0][1].params.namespace).toBe("profile-classicann-eu");
        });
    });

    describe("getCharacterSummary", () => {
        function configured() {
            return new Blizzard({ clientId: "id", clientSecret: "secret" });
        }

        it("returns the character's level, item level, realm and last-login", async () => {
            axios.post.mockResolvedValue({ data: { access_token: "tok", expires_in: 3600 } });
            axios.get.mockResolvedValue({ data: {
                name: "Foo", level: 70, average_item_level: 115, last_login_timestamp: 1784574268000,
                realm: { name: "Thunderstrike" }, character_class: { name: "Shaman" }, faction: { name: "Horde" },
            } });
            const c = configured();
            const s = await c.getCharacterSummary("Foo");
            // hits the base character profile (no /equipment suffix)
            expect(axios.get.mock.calls[0][0]).toBe("https://eu.api.blizzard.com/profile/wow/character/thunderstrike/foo");
            expect(s).toMatchObject({
                name: "Foo", level: 70, itemLevel: 115, lastLogin: 1784574268000,
                realm: "Thunderstrike", className: "Shaman", faction: "Horde", namespace: "profile-classicann-eu",
            });
        });

        it("returns null and records lastError on failure", async () => {
            axios.post.mockResolvedValue({ data: { access_token: "tok", expires_in: 3600 } });
            axios.get.mockRejectedValue({ response: { status: 404 } });
            const c = configured();
            expect(await c.getCharacterSummary("Ghost")).toBeNull();
            expect(c.lastError).toMatchObject({ status: 404 });
        });

        it("returns null without credentials", async () => {
            expect(await new Blizzard().getCharacterSummary("Foo")).toBeNull();
            expect(axios.get).not.toHaveBeenCalled();
        });
    });
});

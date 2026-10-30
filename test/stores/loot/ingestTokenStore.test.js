// In-memory fs so the store never touches the repo disk.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const {
    listTokens, createToken, createPersonToken, listTokensOfOwner, getToken, assignTokenGuild, revokeToken, verifyToken, touchToken, bearerFrom, TOKEN_PREFIX,
} = require("../../../src/stores/loot/ingestTokenStore.js");

beforeEach(() => {
    fs.__store.clear();
});

/** The raw JSON the store persisted, to assert on what is actually on disk. */
function stored() {
    const [, data] = [...fs.__store.entries()][0] || [];
    return data ? JSON.parse(data) : { tokens: [] };
}

describe("stores/loot/ingestTokenStore", () => {
    describe("createToken", () => {
        it("returns a prefixed secret and a record without it", () => {
            const { token, record } = createToken("Raidlead-PC", "Admin");
            expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
            expect(token.length).toBeGreaterThan(40);
            expect(record.name).toBe("Raidlead-PC");
            expect(record.createdBy).toBe("Admin");
            expect(record).not.toHaveProperty("hash");
        });

        it("falls back to a default name for a blank one", () => {
            expect(createToken("  ").record.name).toBe("Loot-Sync");
        });

        it("mints a different secret every time", () => {
            expect(createToken("a").token).not.toBe(createToken("b").token);
        });

        // #994: every token works on one Discord server.
        it("stores the server the token belongs to", () => {
            const { token, record } = createToken("PC", "Admin", "gA");
            expect(record.guildId).toBe("gA");
            expect(verifyToken(token).guildId).toBe("gA");
        });

        it("leaves the server empty when none is given", () => {
            expect(createToken("PC").record.guildId).toBe("");
        });
    });

    describe("assignTokenGuild", () => {
        it("gives a token without a server one", () => {
            const { token, record } = createToken("PC");
            expect(assignTokenGuild(record.id, "gB")).toMatchObject({ id: record.id, guildId: "gB" });
            expect(verifyToken(token).guildId).toBe("gB");
            expect(stored().tokens[0]).not.toHaveProperty("token");
        });

        it("returns null for an unknown id", () => {
            createToken("PC");
            expect(assignTokenGuild("nope", "gB")).toBeNull();
            expect(listTokens()[0].guildId).toBe("");
        });

        it("reads an old record without the field as no server", () => {
            createToken("PC");
            const data = stored();
            delete data.tokens[0].guildId;
            fs.__store.set([...fs.__store.keys()][0], JSON.stringify(data));
            expect(listTokens()[0].guildId).toBe("");
        });
    });

    // #1000: a personal key belongs to a Discord account, not to a server.
    describe("personal keys", () => {
        it("stores the owner and no server", () => {
            const { token, record } = createPersonToken("Laptop", "u1");
            expect(record).toMatchObject({ name: "Laptop", ownerId: "u1", guildId: "", createdBy: "u1", uses: 0 });
            expect(verifyToken(token).ownerId).toBe("u1");
        });

        it("refuses a key without an owner", () => {
            expect(() => createPersonToken("Laptop", "")).toThrow();
            expect(listTokens()).toEqual([]);
        });

        it("lists one owner's keys only and finds one by id", () => {
            const anna = createPersonToken("Laptop", "u1", "Anna").record;
            createPersonToken("PC", "u2");
            createToken("Server-PC", "Admin", "gA");
            expect(listTokensOfOwner("u1").map((t) => t.id)).toEqual([anna.id]);
            expect(listTokensOfOwner("")).toEqual([]);
            expect(getToken(anna.id)).toMatchObject({ ownerId: "u1", createdBy: "Anna" });
            expect(getToken(anna.id)).not.toHaveProperty("hash");
            expect(getToken("nope")).toBeNull();
        });

        it("never gets a server assigned", () => {
            const { record } = createPersonToken("Laptop", "u1");
            expect(assignTokenGuild(record.id, "gA")).toBeNull();
            expect(getToken(record.id).guildId).toBe("");
        });

        it("reads an old record without an owner as a server or old key", () => {
            expect(createToken("PC", "Admin", "gA").record.ownerId).toBe("");
        });
    });

    // The whole point of the store: a stolen settings file must not be replayable.
    describe("storage", () => {
        it("never writes the plaintext token to disk", () => {
            const { token } = createToken("PC");
            expect(JSON.stringify(stored())).not.toContain(token);
        });

        it("stores a sha256 hash and a 4-char hint instead", () => {
            const { token } = createToken("PC");
            const [row] = stored().tokens;
            expect(row.hash).toMatch(/^[a-f0-9]{64}$/);
            expect(row.hint).toBe(token.slice(-4));
        });
    });

    describe("verifyToken", () => {
        it("recognises a token it minted", () => {
            const { token, record } = createToken("PC");
            expect(verifyToken(token)).toMatchObject({ id: record.id, name: "PC" });
        });

        it("rejects an unknown, malformed or empty token", () => {
            createToken("PC");
            expect(verifyToken(`${TOKEN_PREFIX}deadbeef`)).toBeNull();
            expect(verifyToken("not-a-token")).toBeNull();
            expect(verifyToken("")).toBeNull();
            expect(verifyToken(null)).toBeNull();
        });

        it("tells two tokens apart", () => {
            const a = createToken("A");
            const b = createToken("B");
            expect(verifyToken(a.token).name).toBe("A");
            expect(verifyToken(b.token).name).toBe("B");
        });

        it("survives a corrupted hash on disk instead of throwing", () => {
            const { token } = createToken("PC");
            const data = stored();
            data.tokens[0].hash = "not-hex";
            fs.__store.set([...fs.__store.keys()][0], JSON.stringify(data));
            expect(verifyToken(token)).toBeNull();
        });

        it("refuses a revoked token immediately", () => {
            const { token, record } = createToken("PC");
            expect(revokeToken(record.id)).toBe(true);
            expect(verifyToken(token)).toBeNull();
        });
    });

    describe("revokeToken", () => {
        it("reports false for an unknown id and leaves the rest alone", () => {
            createToken("PC");
            expect(revokeToken("nope")).toBe(false);
            expect(listTokens()).toHaveLength(1);
        });
    });

    describe("listTokens", () => {
        it("lists newest first and never leaks a hash", () => {
            const first = createToken("Old");
            // createdAt has ms resolution — force a distinct order.
            const data = stored();
            data.tokens[0].createdAt = 1000;
            fs.__store.set([...fs.__store.keys()][0], JSON.stringify(data));
            createToken("New");
            const list = listTokens();
            expect(list.map((t) => t.name)).toEqual(["New", "Old"]);
            expect(list.every((t) => !("hash" in t))).toBe(true);
            expect(first.record).not.toHaveProperty("hash");
        });

        it("is empty when nothing was ever created", () => {
            expect(listTokens()).toEqual([]);
        });
    });

    describe("touchToken", () => {
        it("counts uses so a dead token is recognisable in the settings list", () => {
            const { record } = createToken("PC");
            expect(listTokens()[0]).toMatchObject({ uses: 0, lastUsedAt: 0 });
            touchToken(record.id);
            touchToken(record.id);
            const [row] = listTokens();
            expect(row.uses).toBe(2);
            expect(row.lastUsedAt).toBeGreaterThan(0);
        });

        it("reports false for an unknown id", () => {
            expect(touchToken("nope")).toBe(false);
        });
    });

    describe("bearerFrom", () => {
        it("reads the value out of an Authorization header", () => {
            expect(bearerFrom({ headers: { authorization: "Bearer ehl_abc" } })).toBe("ehl_abc");
            expect(bearerFrom({ headers: { authorization: "bearer  ehl_abc  " } })).toBe("ehl_abc");
        });

        it("returns an empty string when there is no usable header", () => {
            expect(bearerFrom({ headers: {} })).toBe("");
            expect(bearerFrom({ headers: { authorization: "Basic abc" } })).toBe("");
            expect(bearerFrom({})).toBe("");
            expect(bearerFrom(null)).toBe("");
        });
    });
});

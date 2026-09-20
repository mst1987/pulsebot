// Subscription tokens for the raider calendar feed (#312). The token in the
// feed url is the whole authentication, so the tests that matter are the ones
// about what is on disk (a hash, never the secret), who may revoke what (only
// the owner) and that a revoked token is dead at once.
const fs = require("fs");
const { tempStoreFile } = require("../helpers/tempStore");
const store = require("../../src/web/calendarTokenStore");

const FILE = tempStoreFile("calendar-tokens.json");

const BROKK = "111111111111111111";
const ZIBBO = "222222222222222222";

/** The raw JSON the store persisted, to assert on what is actually on disk. */
const stored = () => {
    try {
        return JSON.parse(fs.readFileSync(FILE, "utf8"));
    } catch {
        return { tokens: [] };
    }
};

beforeEach(() => {
    store.useFile(FILE);
    try {
        fs.unlinkSync(FILE);
    } catch {
        // the first run has no file yet
    }
});

afterAll(() => store.useFile(null));

describe("web/calendarTokenStore", () => {
    describe("createToken", () => {
        it("returns a prefixed secret and a record without it", () => {
            const { token, record } = store.createToken(BROKK, "Handy");
            expect(token.startsWith(store.TOKEN_PREFIX)).toBe(true);
            expect(token.length).toBeGreaterThan(40);
            expect(record).toMatchObject({ userId: BROKK, name: "Handy" });
            expect(record).not.toHaveProperty("hash");
        });

        it("names an unnamed link and clips a very long name", () => {
            expect(store.createToken(BROKK, "   ").record.name).toBe("Kalender");
            expect(store.createToken(BROKK, "x".repeat(200)).record.name).toHaveLength(store.MAX_NAME);
        });

        it("mints a different secret every time", () => {
            expect(store.createToken(BROKK).token).not.toBe(store.createToken(BROKK).token);
        });

        it("refuses without an account", () => {
            expect(store.createToken("")).toMatchObject({ code: "no_user" });
        });

        it("stops at MAX_PER_USER — per raider, not overall", () => {
            for (let i = 0; i < store.MAX_PER_USER; i += 1) expect(store.createToken(BROKK).token).toBeTruthy();
            expect(store.createToken(BROKK)).toMatchObject({ code: "too_many" });
            // somebody else is not affected by that
            expect(store.createToken(ZIBBO).token).toBeTruthy();
        });
    });

    // The whole point of the store: a stolen settings file or a backup must not
    // be replayable into somebody's raid calendar.
    describe("storage", () => {
        it("never writes the plaintext token to disk", () => {
            const { token } = store.createToken(BROKK);
            expect(JSON.stringify(stored())).not.toContain(token);
        });

        it("stores a sha256 hash and a 4-char hint instead", () => {
            const { token } = store.createToken(BROKK);
            const [row] = stored().tokens;
            expect(row.hash).toMatch(/^[a-f0-9]{64}$/);
            expect(row.hint).toBe(token.slice(-4));
        });
    });

    describe("verifyToken", () => {
        it("recognises a token it minted and names its owner", () => {
            const { token, record } = store.createToken(BROKK, "Handy");
            expect(store.verifyToken(token)).toMatchObject({ id: record.id, userId: BROKK, name: "Handy" });
            expect(store.verifyToken(token)).not.toHaveProperty("hash");
        });

        it("rejects an unknown, malformed or empty token", () => {
            store.createToken(BROKK);
            expect(store.verifyToken(`${store.TOKEN_PREFIX}deadbeef`)).toBeNull();
            expect(store.verifyToken("not-a-token")).toBeNull();
            expect(store.verifyToken("")).toBeNull();
            expect(store.verifyToken(null)).toBeNull();
        });

        it("tells two raiders' tokens apart", () => {
            const a = store.createToken(BROKK);
            const b = store.createToken(ZIBBO);
            expect(store.verifyToken(a.token).userId).toBe(BROKK);
            expect(store.verifyToken(b.token).userId).toBe(ZIBBO);
        });

        it("survives a corrupted hash on disk instead of throwing", () => {
            const { token } = store.createToken(BROKK);
            const data = stored();
            data.tokens[0].hash = "not-hex";
            fs.writeFileSync(FILE, JSON.stringify(data));
            expect(store.verifyToken(token)).toBeNull();
        });

        it("refuses a revoked token immediately", () => {
            const { token, record } = store.createToken(BROKK);
            expect(store.revokeToken(record.id, BROKK)).toBe(true);
            expect(store.verifyToken(token)).toBeNull();
        });
    });

    describe("revokeToken", () => {
        it("refuses to revoke another raider's token", () => {
            const { token, record } = store.createToken(BROKK);
            expect(store.revokeToken(record.id, ZIBBO)).toBe(false);
            expect(store.verifyToken(token)).toBeTruthy();
        });

        it("reports false for an unknown id and leaves the rest alone", () => {
            store.createToken(BROKK);
            expect(store.revokeToken("nope", BROKK)).toBe(false);
            expect(store.listTokensFor(BROKK)).toHaveLength(1);
        });

        it("revokeAllFor takes only that raider's links", () => {
            store.createToken(BROKK);
            store.createToken(BROKK);
            store.createToken(ZIBBO);
            expect(store.revokeAllFor(BROKK)).toBe(2);
            expect(store.listTokensFor(BROKK)).toEqual([]);
            expect(store.listTokensFor(ZIBBO)).toHaveLength(1);
            expect(store.revokeAllFor("")).toBe(0);
        });
    });

    describe("listTokensFor", () => {
        it("lists only one's own, newest first, and never a hash", () => {
            const old = store.createToken(BROKK, "Alt");
            const data = stored();
            data.tokens[0].createdAt = 1000;
            fs.writeFileSync(FILE, JSON.stringify(data));
            store.createToken(BROKK, "Neu");
            store.createToken(ZIBBO, "Fremd");
            const list = store.listTokensFor(BROKK);
            expect(list.map((t) => t.name)).toEqual(["Neu", "Alt"]);
            expect(list.every((t) => !("hash" in t))).toBe(true);
            expect(old.record).not.toHaveProperty("hash");
        });

        it("is empty for a raider without links and without an account", () => {
            expect(store.listTokensFor(BROKK)).toEqual([]);
            expect(store.listTokensFor("")).toEqual([]);
        });
    });

    describe("touchToken", () => {
        it("counts fetches, so the profile can say 'noch nie abgerufen'", () => {
            const { record } = store.createToken(BROKK);
            expect(store.listTokensFor(BROKK)[0]).toMatchObject({ uses: 0, lastUsedAt: 0 });
            store.touchToken(record.id);
            store.touchToken(record.id);
            const [row] = store.listTokensFor(BROKK);
            expect(row.uses).toBe(2);
            expect(row.lastUsedAt).toBeGreaterThan(0);
        });

        it("reports false for an unknown id", () => {
            expect(store.touchToken("nope")).toBe(false);
        });
    });
});

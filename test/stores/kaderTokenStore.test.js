// The Kaderbau tokens: the same security model as the loot-sync tokens
// (bearerTokenStore.js), but a capability of their own — a loot token must not
// read the export, a Kaderbau token must not upload loot.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const kader = require("../../src/stores/kaderTokenStore.js");
const ingest = require("../../src/stores/ingestTokenStore.js");

beforeEach(() => {
    fs.__store.clear();
});

describe("stores/kaderTokenStore", () => {
    it("mints ehk_ tokens with the Kaderbau default name", () => {
        const { token, record } = kader.createToken("  ", "Admin");
        expect(kader.TOKEN_PREFIX).toBe("ehk_");
        expect(token.startsWith("ehk_")).toBe(true);
        expect(record).toMatchObject({ name: "Kaderbau", createdBy: "Admin", uses: 0 });
        expect(record).not.toHaveProperty("hash");
    });

    it("verifies its own token and forgets it on revoke", () => {
        const { token, record } = kader.createToken("Raidlead-PC");
        expect(kader.verifyToken(token)).toMatchObject({ id: record.id, name: "Raidlead-PC" });
        expect(kader.revokeToken(record.id)).toBe(true);
        expect(kader.verifyToken(token)).toBeNull();
    });

    it("keeps its file apart from the loot-sync tokens and never writes the secret", () => {
        const { token } = kader.createToken("PC");
        const files = [...fs.__store.keys()];
        expect(files).toHaveLength(1);
        expect(files[0]).toMatch(/kader-tokens\.json$/);
        expect(fs.__store.get(files[0])).not.toContain(token);
    });

    describe("capability separation", () => {
        it("does not accept a loot-sync token", () => {
            const loot = ingest.createToken("Loot-PC");
            expect(kader.verifyToken(loot.token)).toBeNull();
        });

        it("is unknown to the loot-sync store", () => {
            const { token } = kader.createToken("PC");
            expect(ingest.verifyToken(token)).toBeNull();
        });

        it("does not accept a loot-sync secret with the prefix swapped", () => {
            const loot = ingest.createToken("Loot-PC");
            expect(kader.verifyToken(loot.token.replace(/^ehl_/, "ehk_"))).toBeNull();
        });

        it("lists only its own tokens", () => {
            ingest.createToken("Loot-PC");
            kader.createToken("Kader-PC");
            expect(kader.listTokens().map((t) => t.name)).toEqual(["Kader-PC"]);
            expect(ingest.listTokens().map((t) => t.name)).toEqual(["Loot-PC"]);
        });
    });
});

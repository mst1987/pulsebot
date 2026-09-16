// Claude explains a setup (#263) — prompt content and the call, with a mocked client.
jest.mock("@anthropic-ai/sdk", () => jest.fn());
const { explainSetup, buildPrompt } = require("../../../src/utils/setup/explainText");

const setup = {
    checks: {
        size: { count: 10, size: 10 },
        roles: { tank: { count: 1, min: 1, max: 1, ok: true }, healer: { count: 1, min: 2, max: 2, ok: false } },
        buffs: { required: [{ key: "kings", label: "Segen der Könige", present: false }], raid: [{ label: "Blutrausch", present: false }] },
        wishes: { met: 1, total: 2 },
    },
    groups: [{ index: 1, slots: [{ userId: "u1", character: "Brokk", specLabel: "Schutz", role: "tank", locked: true, reasons: ["Von der Orga fixiert"] }] }],
    bench: [{ userId: "u2", character: "Ysolde", specLabel: "Feuer", role: "ranged", reasons: ["Raid voll (10/10)"] }],
    warnings: [],
};
const ctx = {
    event: { title: "Karazhan", size: 10 },
    signups: [
        { userId: "u1", comment: "" },
        { userId: "u2", comment: "kommt 20:30" },
        { userId: "u3", character: "Vexa", status: "absence", comment: "Urlaub" },
    ],
};

describe("buildPrompt", () => {
    it("carries groups, bench, reasons, checks and the raiders' comments", () => {
        const text = buildPrompt(setup, ctx);
        expect(text).toContain("Raid: Karazhan (10 Plätze)");
        expect(text).toContain("Heiler: 1 (Soll 2) – nicht erfüllt");
        expect(text).toContain("Pflicht-Buffs: fehlt Segen der Könige");
        expect(text).toMatch(/Gruppe 1:\n- Brokk \(Schutz, Tank, fixiert\) · Gründe: Von der Orga fixiert/);
        expect(text).toContain("Ysolde (Feuer, Fernkampf) · Gründe: Raid voll (10/10) · Kommentar: „kommt 20:30“");
        expect(text).toContain("- Vexa · Kommentar: „Urlaub“");
    });
});

describe("explainSetup", () => {
    const client = (response) => ({ beta: { messages: { create: jest.fn(async () => response) } } });

    it("returns the model's text and sends the prompt as the user turn", async () => {
        const api = client({ stop_reason: "end_turn", content: [{ type: "text", text: "  Gruppe 1 ist die Tankgruppe.  " }] });
        const out = await explainSetup(setup, ctx, { client: api, model: "claude-test" });
        expect(out).toEqual({ text: "Gruppe 1 ist die Tankgruppe.", model: "claude-test" });
        const req = api.beta.messages.create.mock.calls[0][0];
        expect(req.model).toBe("claude-test");
        expect(req.messages[0].content).toContain("Brokk");
        expect(req.system[0].text).toMatch(/erklärst/);
    });

    it("refuses without key or client and reports a refusal or an empty answer", async () => {
        await expect(explainSetup(setup, ctx, {})).rejects.toThrow(/API-Key/);
        await expect(explainSetup(setup, ctx, { client: client({ stop_reason: "refusal", content: [] }) })).rejects.toThrow(/abgelehnt/);
        await expect(explainSetup(setup, ctx, { client: client({ stop_reason: "end_turn", content: [] }) })).rejects.toThrow(/Leere/);
    });
});

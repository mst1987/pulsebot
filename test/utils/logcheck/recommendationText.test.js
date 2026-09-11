jest.mock("@anthropic-ai/sdk", () => jest.fn().mockImplementation(() => ({ beta: { messages: { create: jest.fn() } } })));

const Anthropic = require("@anthropic-ai/sdk");
const { phraseReport, phrasePlayer, buildPrompt, parseAnswer, DEFAULT_MODEL, SYSTEM } = require("../../../src/utils/logcheck/recommendationText");

function report() {
    return {
        title: "Gruul", zone: "Gruul's Lair", date: "10.9.2026, 20:05:00",
        recommendations: {
            raid: [],
            players: [
                { name: "Farin", type: "Warlock", items: [
                    { key: "gear", impact: "high", title: "2 Gear-Probleme", text: "Gear fertig machen.", evidence: [{ label: "Kapuze", value: "keine Verzauberung" }] },
                    { key: "activity.low", impact: "medium", title: "Nur 64 % aktiv", text: "…", evidence: [{ label: "Ø aktiv", value: "64 %" }] },
                ] },
                { name: "Dorn", type: "Shaman", items: [{ key: "totems.twisting", impact: "medium", title: "Twisting", text: "Twisten.", evidence: [] }] },
                { name: "Clean", type: "Mage", items: [] },
            ],
        },
    };
}

/** A client whose answer is built from the prompt it received. */
function fakeClient(impl) {
    return { beta: { messages: { create: jest.fn(impl) } } };
}
const answer = (pairs, extra = {}) => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(pairs) }], ...extra });

describe("recommendationText — prompt and parsing", () => {
    it("lists every finding with key, title, hint, weight and evidence", () => {
        const p = buildPrompt(report(), report().recommendations.players[0]);
        expect(p).toContain("Raid: Gruul (Gruul's Lair), 10.9.2026, 20:05:00");
        expect(p).toContain("Raider: Farin, Klasse Warlock");
        expect(p).toContain("- key: gear");
        expect(p).toContain("  Belege: Kapuze: keine Verzauberung");
        expect(p).toContain("  Gewicht: medium");
        expect(SYSTEM).toContain("JSON-Array");
    });

    it("parses the JSON array, tolerating prose and fences, and drops malformed rows", () => {
        const m = parseAnswer("Hier:\n```json\n[{\"key\":\"gear\",\"text\":\" Bitte verzaubern. \"},{\"key\":\"x\"},{\"key\":\"y\",\"text\":\"\"}]\n```");
        expect([...m.entries()]).toEqual([["gear", "Bitte verzaubern."]]);
        expect(() => parseAnswer("kein json")).toThrow("kein JSON-Array");
        expect(() => parseAnswer("[1,2]")).not.toThrow();
        expect(() => parseAnswer("{\"a\":1}")).toThrow();
    });
});

describe("recommendationText — phrasePlayer", () => {
    it("calls the Messages API with the documented shape and returns the texts by key", async () => {
        const client = fakeClient(async () => answer([{ key: "gear", text: "A" }, { key: "activity.low", text: "B" }]));
        const texts = await phrasePlayer(client, report(), report().recommendations.players[0]);
        expect(texts.get("gear")).toBe("A");
        const req = client.beta.messages.create.mock.calls[0][0];
        expect(req.model).toBe(DEFAULT_MODEL);
        expect(DEFAULT_MODEL).toBe("claude-opus-5");
        expect(req.thinking).toEqual({ type: "adaptive" });
        expect(req.output_config).toEqual({ effort: "low" });
        expect(req.betas).toEqual(["server-side-fallback-2026-07-01"]);
        expect(req.fallbacks).toBe("default");
        expect(req.system[0].cache_control).toEqual({ type: "ephemeral" });
        expect(req.messages[0].role).toBe("user");
        expect(req.messages[0].content).toContain("- key: gear");
    });

    it("skips the call for a raider without findings, and reports a refusal or a cut-off answer", async () => {
        const client = fakeClient(async () => answer([]));
        expect((await phrasePlayer(client, report(), { name: "Clean", items: [] })).size).toBe(0);
        expect(client.beta.messages.create).not.toHaveBeenCalled();
        await expect(phrasePlayer(fakeClient(async () => ({ stop_reason: "refusal", content: [] })), report(), report().recommendations.players[0])).rejects.toThrow("abgelehnt");
        await expect(phrasePlayer(fakeClient(async () => answer([], { stop_reason: "max_tokens" })), report(), report().recommendations.players[0])).rejects.toThrow("max_tokens");
    });
});

describe("recommendationText — phraseReport", () => {
    it("phrases every raider with findings, writes item.ai, keeps the rule text and records the run", async () => {
        const client = fakeClient(async (req) => {
            const name = req.messages[0].content.match(/Raider: (\w+)/)[1];
            return name === "Farin"
                ? answer([{ key: "gear", text: "Farin, bitte verzaubern." }])
                : answer([{ key: "totems.twisting", text: "Dorn, twisten." }]);
        });
        const r = report();
        const result = await phraseReport(r, { client, model: "claude-opus-5" });
        expect(client.beta.messages.create).toHaveBeenCalledTimes(2);
        const farin = r.recommendations.players[0];
        expect(farin.items[0].ai).toBe("Farin, bitte verzaubern.");
        expect(farin.items[0].text).toBe("Gear fertig machen.");
        expect(farin.items[1].ai).toBeUndefined();   // the model skipped it: rule text stays
        expect(r.recommendations.players[1].items[0].ai).toBe("Dorn, twisten.");
        expect(result).toEqual({ phrased: 2, players: 2, errors: [], model: "claude-opus-5" });
        expect(r.recommendationPhrase).toEqual(expect.objectContaining({ phrased: 2, players: 2, model: "claude-opus-5" }));
    });

    it("restricts to the named raiders and keeps going when one request fails", async () => {
        let n = 0;
        const client = fakeClient(async () => { if (n++ === 0) throw new Error("rate limited"); return answer([{ key: "totems.twisting", text: "ok" }]); });
        const r = report();
        const result = await phraseReport(r, { client, only: ["Farin", "Dorn"], concurrency: 1 });
        expect(result.errors).toEqual([{ name: "Farin", error: "rate limited" }]);
        expect(result.players).toBe(1);
        expect(r.recommendations.players[1].items[0].ai).toBe("ok");
        const solo = await phraseReport(report(), { client: fakeClient(async () => answer([])), only: ["Dorn"] });
        expect(solo.players).toBe(1);
    });

    it("builds the SDK client from the stored key and refuses without one", async () => {
        Anthropic.mockClear();
        Anthropic.mockImplementation(() => fakeClient(async () => answer([])));
        await phraseReport(report(), { apiKey: "sk-test" });
        expect(Anthropic).toHaveBeenCalledWith({ apiKey: "sk-test" });
        await expect(phraseReport(report(), {})).rejects.toThrow("Kein Anthropic-API-Key");
    });
});

jest.mock("@anthropic-ai/sdk", () => jest.fn().mockImplementation((opts) => ({ opts })));

const Anthropic = require("@anthropic-ai/sdk");
const { createAnthropicClient } = require("../../src/classes/anthropic");

describe("classes/anthropic", () => {
    it("creates an SDK client with the given key", () => {
        const client = createAnthropicClient({ apiKey: "sk-test" });
        expect(Anthropic).toHaveBeenCalledWith({ apiKey: "sk-test" });
        expect(client).toEqual({ opts: { apiKey: "sk-test" } });
    });

    it("refuses without a key and creates nothing", () => {
        expect(() => createAnthropicClient({})).toThrow("Kein Anthropic-API-Key hinterlegt.");
        expect(() => createAnthropicClient()).toThrow("Kein Anthropic-API-Key hinterlegt.");
        expect(Anthropic).not.toHaveBeenCalled();
    });
});

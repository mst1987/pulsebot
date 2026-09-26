// A proxy's HTML error page never reaches the person (api/client.ts): a sentence in his language, the HTML only in the console.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "../../src/web-client/src");
const api = fs.readFileSync(path.join(root, "api/client.ts"), "utf8");

describe("non-JSON answers of the server / a proxy", () => {
    it("says what happened in words and keeps the HTML out of the message", () => {
        expect(api).toContain("export function nonJsonMessage(status: number, ok: boolean)");
        expect(api).toContain("status === 413");
        expect(api).toContain("502 || status === 503 || status === 504");
        const parse = api.slice(api.indexOf("async function parseJson"), api.indexOf("function errorFrom"));
        expect(parse).toContain("console.error(");
        expect(parse).toContain("nonJsonMessage(res.status, res.ok)");
        expect(parse).not.toMatch(/message:[^\n]*snippet/);
        expect(parse).not.toContain("Serverfehler (HTTP");
    });
    it("has the sentences in both languages, the 413 one naming the proxy limit", () => {
        for (const lang of ["de", "en"]) {
            const d = JSON.parse(fs.readFileSync(path.join(root, "i18n/locales", lang, "common.json"), "utf8")).errors;
            for (const k of ["badResponse", "tooLarge", "gateway", "server"]) expect(typeof d[k]).toBe("string");
            expect(d.tooLarge).toMatch(/Proxy|proxy/);
            expect(d.gateway).toContain("{status}");
        }
    });
});

// A proxy's HTML error page never reaches the person (api/client.ts): an answer
// that is no JSON becomes an ApiError with a sentence in the menu's language,
// the HTML goes to the console only.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get, nonJsonMessage, send, type ApiError } from "./client";
import { t } from "../i18n";
import { switchLang } from "../test/i18n";

const HTML = "<html><head><title>504 Gateway Time-out</title></head><body><center><h1>504 Gateway Time-out</h1></center><hr><center>nginx</center></body></html>";

/** The next fetch answers with this body and status. */
function answer(body: string, status: number) {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(body, { status }));
}

/** The ApiError a call rejects with. */
async function errorOf(call: Promise<unknown>): Promise<ApiError> {
    try {
        await call;
    } catch (e) {
        return e as ApiError;
    }
    throw new Error("the call did not fail");
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

afterAll(() => switchLang("de"));

describe("nonJsonMessage", () => {
    it("names the proxy limit on 413, the gateway on 502/503/504 and the status otherwise", () => {
        expect(nonJsonMessage(413, false)).toBe(t("common.errors.tooLarge"));
        expect(nonJsonMessage(413, false)).toMatch(/Proxy/);
        for (const status of [502, 503, 504]) {
            expect(nonJsonMessage(status, false)).toBe(t("common.errors.gateway", { status }));
            expect(nonJsonMessage(status, false)).toContain(`HTTP ${status}`);
        }
        expect(nonJsonMessage(500, false)).toBe(t("common.errors.server", { status: 500 }));
        expect(nonJsonMessage(500, false)).toContain("HTTP 500");
        expect(nonJsonMessage(200, true)).toBe(t("common.errors.badResponse"));
    });

    it("speaks the menu's language", async () => {
        const de = [nonJsonMessage(413, false), nonJsonMessage(504, false), nonJsonMessage(500, false), nonJsonMessage(200, true)];
        await switchLang("en");
        const en = [nonJsonMessage(413, false), nonJsonMessage(504, false), nonJsonMessage(500, false), nonJsonMessage(200, true)];
        await switchLang("de");
        expect(de[0]).toMatch(/Proxy-Limit/);
        expect(en[0]).toMatch(/proxy limit/);
        expect(en[1]).toContain("HTTP 504");
        expect(en[2]).toBe("Server error (HTTP 500).");
        en.forEach((text, i) => expect(text).not.toBe(de[i]));
    });
});

describe("a non-JSON answer of the server or a proxy", () => {
    it("turns a 413 of send() into the proxy-limit sentence", async () => {
        answer("<html><body><h1>413 Request Entity Too Large</h1></body></html>", 413);
        const err = await errorOf(send("POST", "/api/raidplan/map", { image: "x" }));
        expect(err).toEqual({ code: "http_413", message: t("common.errors.tooLarge") });
    });

    it("turns 502, 503 and 504 of get() into the gateway sentence with the status", async () => {
        for (const status of [502, 503, 504]) {
            answer(HTML, status);
            const err = await errorOf(get("/api/dashboard"));
            expect(err).toEqual({ code: `http_${status}`, message: t("common.errors.gateway", { status }) });
        }
    });

    it("turns any other error page into 'Serverfehler (HTTP …)'", async () => {
        answer("<html>Internal Server Error</html>", 500);
        const err = await errorOf(get("/api/dashboard"));
        expect(err).toEqual({ code: "http_500", message: t("common.errors.server", { status: 500 }) });
    });

    it("calls an ok answer that is no JSON a bad response", async () => {
        answer("<!doctype html><html>index</html>", 200);
        const err = await errorOf(get("/api/dashboard"));
        expect(err).toEqual({ code: "bad_response", message: t("common.errors.badResponse") });
    });

    it("keeps the HTML out of the message and writes it to the console", async () => {
        answer(HTML, 504);
        const err = await errorOf(send("PUT", "/api/settings", {}));
        expect(err.message).not.toMatch(/<|nginx|Gateway Time-out/);
        expect(consoleError).toHaveBeenCalledTimes(1);
        const logged = consoleError.mock.calls[0].join(" ");
        expect(logged).toContain("HTTP 504");
        expect(logged).toContain("nginx");
    });

    it("gives the English sentence when the menu is English", async () => {
        await switchLang("en");
        answer(HTML, 413);
        const err = await errorOf(send("POST", "/api/raidplan/map", {}));
        expect(err.message).toBe("The file is too large for the server (proxy limit). Please choose a smaller image.");
        await switchLang("de");
    });

    it("still passes the server's own JSON error through", async () => {
        answer(JSON.stringify({ error: { code: "forbidden", message: "Kein Zugriff" } }), 403);
        const err = await errorOf(get("/api/dashboard"));
        expect(err).toEqual({ code: "forbidden", message: "Kein Zugriff" });
        expect(consoleError).not.toHaveBeenCalled();
    });
});

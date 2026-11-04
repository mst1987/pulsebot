const { canonicalRedirect } = require("../../../src/web/http/canonicalHost");

const BASE = "https://www.pulse.example";
const req = (host, url = "/raids?event=eh-1", method = "GET") => ({ method, url, headers: host ? { host } : {} });

describe("web/http/canonicalHost", () => {
    it.each([
        ["the bare domain", "pulse.example"],
        ["an old subdomain", "logcheck.pulse.example"],
        ["upper case and a port", "LOGCHECK.Pulse.Example:443"],
    ])("sends %s to the public address and keeps path and query", (_label, host) => {
        expect(canonicalRedirect(req(host), BASE)).toBe("https://www.pulse.example/raids?event=eh-1");
    });

    it("also moves HEAD and the login itself, so the cookie lands where the next visit asks for it", () => {
        expect(canonicalRedirect(req("pulse.example", "/", "HEAD"), BASE)).toBe("https://www.pulse.example/");
        expect(canonicalRedirect(req("pulse.example", "/auth/login?returnTo=%2Fraids"), BASE)).toBe("https://www.pulse.example/auth/login?returnTo=%2Fraids");
    });

    it("leaves the public address alone", () => {
        expect(canonicalRedirect(req("www.pulse.example"), BASE)).toBeNull();
        expect(canonicalRedirect(req("www.pulse.example:443"), BASE)).toBeNull();
    });

    it.each([
        ["a test instance", "localhost:3016"],
        ["the tailnet name", "eventhelper.tail59443d.ts.net:3005"],
        ["a foreign domain ending alike", "notpulse.example"],
        ["no Host header", ""],
    ])("leaves %s alone", (_label, host) => {
        expect(canonicalRedirect(req(host), BASE)).toBeNull();
    });

    it.each([
        ["an API read", "/api/session"],
        ["the health check", "/health"],
    ])("does not move %s", (_label, url) => {
        expect(canonicalRedirect(req("pulse.example", url), BASE)).toBeNull();
    });

    it("moves a page whose name only starts like the health check", () => {
        expect(canonicalRedirect(req("pulse.example", "/healthy"), BASE)).toBe("https://www.pulse.example/healthy");
    });

    it("does not move a write: a redirect would lose its body", () => {
        expect(canonicalRedirect(req("pulse.example", "/some/form", "POST"), BASE)).toBeNull();
    });

    it("never takes the target from the Host header or lets the path change the host", () => {
        expect(canonicalRedirect(req("evil.pulse.example", "//evil.example/x"), BASE)).toBe("https://www.pulse.example//evil.example/x");
        expect(new URL(canonicalRedirect(req("evil.pulse.example", "//evil.example/x"), BASE)).host).toBe("www.pulse.example");
    });

    it("works for a public address without www", () => {
        expect(canonicalRedirect(req("www.pulse.example"), "https://pulse.example")).toBe("https://pulse.example/raids?event=eh-1");
        expect(canonicalRedirect(req("pulse.example"), "https://pulse.example")).toBeNull();
    });

    it("stays put on a local address", () => {
        expect(canonicalRedirect(req("localhost:3016"), "http://localhost:3016")).toBeNull();
        expect(canonicalRedirect(req("127.0.0.1:3016"), "http://localhost:3016")).toBeNull();
    });
});

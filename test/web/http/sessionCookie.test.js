const load = (publicBaseUrl) => {
    let mod;
    jest.isolateModules(() => {
        jest.doMock("../../../src/config/variables", () => ({ publicBaseUrl }));
        mod = require("../../../src/web/http/sessionCookie");
    });
    return mod;
};

describe("web/http/sessionCookie", () => {
    afterEach(() => jest.dontMock("../../../src/config/variables"));

    it("lasts 30 days and is only sent over https when the public address has it", () => {
        const { sessionCookie, SESSION_TTL } = load("https://www.pulse.example");
        expect(SESSION_TTL).toBe(30 * 86400000);
        expect(sessionCookie("abc")).toBe("sid=abc; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000; Secure");
    });

    it("stays usable on a local test instance without https", () => {
        const { sessionCookie, clearedSessionCookie } = load("http://localhost:3016");
        expect(sessionCookie("abc")).toBe("sid=abc; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000");
        expect(clearedSessionCookie()).toBe("sid=; HttpOnly; Path=/; Max-Age=0");
    });

    it("ends a session with the same attributes it was set with", () => {
        expect(load("https://www.pulse.example").clearedSessionCookie()).toBe("sid=; HttpOnly; Path=/; Max-Age=0; Secure");
    });
});

// services/addons/downloadLimit.js: at most LIMIT downloads per account in a
// rolling hour.
const { takeDownload, resetDownloadLimit, LIMIT, WINDOW_MS } = require("../../../src/services/addons/downloadLimit");

beforeEach(() => resetDownloadLimit());

describe("takeDownload", () => {
    it("allows LIMIT downloads per hour and account, then says when the next one is free", () => {
        const now = 1_000_000;
        for (let i = 0; i < LIMIT; i++) expect(takeDownload("u1", now + i).ok).toBe(true);
        const refused = takeDownload("u1", now + LIMIT);
        expect(refused).toEqual({ ok: false, retryAfterSec: Math.ceil((WINDOW_MS - LIMIT) / 1000) });
        // another account has its own count
        expect(takeDownload("u2", now + LIMIT)).toEqual({ ok: true, left: LIMIT - 1 });
    });

    it("frees a slot once the oldest download leaves the window", () => {
        expect(takeDownload("u1", 0, { limit: 2, windowMs: 100 }).ok).toBe(true);
        expect(takeDownload("u1", 50, { limit: 2, windowMs: 100 }).ok).toBe(true);
        expect(takeDownload("u1", 99, { limit: 2, windowMs: 100 }).ok).toBe(false);
        expect(takeDownload("u1", 100, { limit: 2, windowMs: 100 })).toEqual({ ok: true, left: 0 });
    });

    it("counts a refused attempt nowhere", () => {
        takeDownload("u1", 0, { limit: 1, windowMs: 100 });
        takeDownload("u1", 10, { limit: 1, windowMs: 100 });
        expect(takeDownload("u1", 100, { limit: 1, windowMs: 100 }).ok).toBe(true);
    });
});

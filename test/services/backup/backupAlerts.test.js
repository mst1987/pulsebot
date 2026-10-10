// The DM to the bootstrap admin (#696): only for red parts, at most once a day per part and state, at once again when
// the state changes or the part recovered in between, nothing marked while the bot is offline.
jest.mock("../../../src/services/backup/backupStatus", () => ({
    readParts: jest.fn(),
    PARTS: ["snapshot", "offsite", "restoreTest"],
}));

const status = require("../../../src/services/backup/backupStatus");
const store = require("../../../src/stores/backupAlertStore");
const alerts = require("../../../src/services/backup/backupAlerts");
const { tempStoreFile } = require("../../helpers/tempStore");

const H = 3600 * 1000;
const T0 = Date.UTC(2026, 9, 10, 12, 0, 0);

const part = (key, light, state = "fresh", extra = {}) => ({ key, light, state, at: T0 - 30 * H, error: "", ...extra });
const set = (snapshot, offsite = part("offsite", "ok"), restoreTest = part("restoreTest", "none", "never")) => {
    status.readParts.mockReturnValue({ parts: [snapshot, offsite, restoreTest] });
};

let send;
beforeEach(() => {
    store.useFile(tempStoreFile("backup-alerts.json"));
    send = jest.fn(async () => ({ ok: true }));
});
afterAll(() => store.useFile(null));

const run = (now) => alerts.check({ now, send, adminId: "42,43" });

describe("backup alerts", () => {
    it("sends nothing while every part is green, yellow or grey", async () => {
        set(part("snapshot", "warn", "stale"), part("offsite", "ok"), part("restoreTest", "none", "never"));
        expect(await run(T0)).toEqual({ sent: [] });
        expect(send).not.toHaveBeenCalled();
    });

    it("sends one German DM to the first admin id when a part is red, naming the error", async () => {
        set(part("snapshot", "bad", "failed", { error: "Platte voll" }));
        const res = await run(T0);
        expect(res.sent).toEqual(["snapshot"]);
        expect(send).toHaveBeenCalledTimes(1);
        const [user, payload] = send.mock.calls[0];
        expect(user).toBe("42");
        expect(payload.content).toContain("Schnappschuss: fehlgeschlagen (Platte voll).");
        expect(payload.content).toContain("Systemstatus");
    });

    it("sends once a day per part: silent for 24 h, then again", async () => {
        set(part("snapshot", "bad", "stale"));
        await run(T0);
        await run(T0 + 30 * 60000);
        await run(T0 + 23 * H);
        expect(send).toHaveBeenCalledTimes(1);
        await run(T0 + 24 * H);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it("tells again at once when the state changes (stale to failed)", async () => {
        set(part("snapshot", "bad", "stale"));
        await run(T0);
        set(part("snapshot", "bad", "failed", { error: "x" }));
        await run(T0 + H);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it("tells again at once after the part was green in between", async () => {
        set(part("snapshot", "bad", "stale"));
        await run(T0);
        set(part("snapshot", "ok"));
        await run(T0 + H);
        set(part("snapshot", "bad", "stale"));
        await run(T0 + 2 * H);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it("throttles each part on its own and sends the due ones in a single message", async () => {
        set(part("snapshot", "bad", "stale"));
        await run(T0);
        set(part("snapshot", "bad", "stale"), part("offsite", "bad", "never"));
        const res = await run(T0 + H);
        expect(res.sent).toEqual(["offsite"]);
        expect(send.mock.calls[1][1].content).toContain("Kopie außer Haus: bisher nie gelaufen.");
        expect(send.mock.calls[1][1].content).not.toContain("Schnappschuss");
    });

    it("marks nothing while the bot is offline, so the next check tries again", async () => {
        set(part("snapshot", "bad", "stale"));
        send.mockRejectedValueOnce(new Error("Bot nicht verbunden."));
        expect(await run(T0)).toEqual({ sent: [], skipped: "offline" });
        await run(T0 + 30 * 60000);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it("counts a DM Discord refused as sent for the day", async () => {
        set(part("snapshot", "bad", "stale"));
        send.mockResolvedValueOnce({ ok: false, error: "closed" });
        await run(T0);
        await run(T0 + H);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it("does nothing without an admin id", async () => {
        set(part("snapshot", "bad", "stale"));
        expect(await alerts.check({ now: T0, send, adminId: "" })).toEqual({ sent: [], skipped: "no-admin" });
    });
});

describe("lineFor", () => {
    it("names the age in hours below two days and in days above", () => {
        expect(alerts.lineFor(part("snapshot", "bad", "stale", { at: T0 - 50 * H }), T0)).toBe("Schnappschuss: zuletzt vor 2 Tagen.");
        expect(alerts.lineFor(part("restoreTest", "bad", "stale", { at: T0 - 30 * H }), T0)).toBe("Wiederherstellungsprobe: zuletzt vor 30 Stunden.");
    });
});

describe("startBackupAlerts", () => {
    afterEach(() => alerts.stopBackupAlerts());

    it("stays off where snapshots are off and starts one timer pair where they are on", () => {
        jest.useFakeTimers();
        try {
            expect(alerts.startBackupAlerts({ env: { EVENTHELPER_ENV_FILE: ".env.dev" } })).toBe(false);
            expect(jest.getTimerCount()).toBe(0);
            expect(alerts.startBackupAlerts({ env: { BACKUP_ENABLED: "1" } })).toBe(true);
            expect(alerts.startBackupAlerts({ env: { BACKUP_ENABLED: "1" } })).toBe(true);
            expect(jest.getTimerCount()).toBe(2);
        } finally {
            jest.useRealTimers();
        }
    });
});

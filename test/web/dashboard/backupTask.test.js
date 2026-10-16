// "Letzte Sicherung vor 3 Tagen" / "Sicherung fehlgeschlagen" (#696) as a task on the start page.
const { buildTasks, _internal: { backupTask } } = require("../../../src/web/dashboard/dashboardOverview");

const H = 3600 * 1000;
const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);
const part = (key, light, state, over = {}) => ({ key, light, state, at: NOW - 30 * H, error: "", ...over });
const parts = (snapshot, offsite = part("offsite", "ok", "fresh"), restoreTest = part("restoreTest", "none", "never", { at: 0 })) => ({ parts: [snapshot, offsite, restoreTest] });

describe("backupTask", () => {
    it("has no task while everything is green or unknown, nor without data", () => {
        expect(backupTask(null, NOW)).toBeNull();
        expect(backupTask(parts(part("snapshot", "ok", "fresh")), NOW)).toBeNull();
        expect(backupTask(parts(part("snapshot", "none", "never", { at: 0 }), part("offsite", "none", "never", { at: 0 })), NOW)).toBeNull();
    });

    it("is yellow after 26 hours and names the age in hours, then days, linking to /system", () => {
        const task = backupTask(parts(part("snapshot", "warn", "stale", { at: NOW - 30 * H })), NOW);
        expect(task).toMatchObject({ id: "backup", tone: "mid", href: "/system", tile: "settings" });
        expect(task.title).toBe("Letzte Sicherung vor 30 Stunden");
        expect(backupTask(parts(part("snapshot", "bad", "stale", { at: NOW - 72 * H })), NOW)).toMatchObject({ tone: "bad", title: "Letzte Sicherung vor 3 Tagen" });
    });

    it("says a failed run is failed, with the error as the tooltip", () => {
        const task = backupTask(parts(part("snapshot", "bad", "failed", { error: "Platte voll" })), NOW);
        expect(task).toMatchObject({ tone: "bad", title: "Sicherung fehlgeschlagen", tipSub: "Platte voll" });
    });

    it("names the part that is worst: red off-site copy before a yellow snapshot", () => {
        const task = backupTask(parts(part("snapshot", "warn", "stale"), part("offsite", "bad", "failed", { error: "R2 nicht erreichbar" })), NOW);
        expect(task.title).toBe("Kopie außer Haus fehlgeschlagen");
        expect(backupTask(parts(part("snapshot", "ok", "fresh"), part("offsite", "bad", "never", { at: 0 })), NOW).title).toBe("Kopie außer Haus: bisher nie gelaufen");
    });
});

describe("buildTasks", () => {
    it("lists the backup task right after the deploy one, and only with backup data", () => {
        expect(buildTasks({}).map((t) => t.id)).not.toContain("backup");
        const ids = buildTasks({
            backup: parts(part("snapshot", "bad", "failed")),
            deploy: { status: "behind", behind: 2, short: "a1b2c3d", behindSince: "2026-09-14T12:00:00Z" },
        }).map((t) => t.id);
        expect(ids.slice(0, 2)).toEqual(["deploy", "backup"]);
    });
});

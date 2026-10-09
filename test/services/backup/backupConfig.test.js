// Where snapshots go and whether this process takes them (#691): BACKUP_DIR, BACKUP_ENABLED and the settings block.
const path = require("path");
const { REPO_ROOT } = require("../../../src/config/paths");
const {
    resolveBackupDir, backupEnabled, normalizeBackupSettings, BACKUP_DEFAULTS, SERVER_BACKUP_DIR,
} = require("../../../src/services/backup/backupConfig");

describe("resolveBackupDir", () => {
    it("takes BACKUP_DIR, a relative value from the repository root", () => {
        expect(resolveBackupDir({ BACKUP_DIR: "/srv/backups" }, "linux")).toBe(path.resolve(REPO_ROOT, "/srv/backups"));
        expect(resolveBackupDir({ BACKUP_DIR: "../bk" }, "win32")).toBe(path.resolve(REPO_ROOT, "..", "bk"));
    });

    it("is /var/backups/pulsebot on the live Linux server", () => {
        expect(resolveBackupDir({ NODE_ENV: "production" }, "linux")).toBe(SERVER_BACKUP_DIR);
        expect(resolveBackupDir({ EVENTHELPER_ENV_FILE: ".env" }, "linux")).toBe("/var/backups/pulsebot");
    });

    it("is <repo>/../pulsebot-backups on Windows and for a dev instance - outside repo and data", () => {
        const fallback = path.resolve(REPO_ROOT, "..", "pulsebot-backups");
        expect(resolveBackupDir({ NODE_ENV: "production" }, "win32")).toBe(fallback);
        expect(resolveBackupDir({ EVENTHELPER_ENV_FILE: ".env.dev" }, "linux")).toBe(fallback);
        expect(path.relative(REPO_ROOT, fallback).startsWith("..")).toBe(true);
    });
});

describe("backupEnabled", () => {
    it("is on for the live bot and off for a dev instance unless BACKUP_ENABLED says otherwise", () => {
        expect(backupEnabled({ NODE_ENV: "production" })).toBe(true);
        expect(backupEnabled({ EVENTHELPER_ENV_FILE: ".env" })).toBe(true);
        expect(backupEnabled({ EVENTHELPER_ENV_FILE: ".env.dev" })).toBe(false);
        expect(backupEnabled({})).toBe(false);
        expect(backupEnabled({ EVENTHELPER_ENV_FILE: ".env.dev", BACKUP_ENABLED: "1" })).toBe(true);
        expect(backupEnabled({ NODE_ENV: "production", BACKUP_ENABLED: "0" })).toBe(false);
        expect(backupEnabled({ NODE_ENV: "production", BACKUP_ENABLED: "false" })).toBe(false);
        expect(backupEnabled({ BACKUP_ENABLED: "maybe" })).toBe(false);
    });
});

describe("normalizeBackupSettings", () => {
    it("is the defaults for nothing stored", () => {
        expect(normalizeBackupSettings(null)).toEqual(BACKUP_DEFAULTS);
        expect(normalizeBackupSettings([1])).toEqual(BACKUP_DEFAULTS);
        expect(normalizeBackupSettings({ retention: "x" })).toEqual(BACKUP_DEFAULTS);
    });

    it("rounds numbers and keeps them within their bounds", () => {
        expect(normalizeBackupSettings({
            intervalMinutes: "90.4",
            retention: { hourlyHours: 0, dailyDays: 400, weeklyWeeks: "x", monthlyMonths: -3, deployKeep: 0, manualKeep: 2.6, preRestoreKeep: null },
        })).toEqual({
            intervalMinutes: 90,
            retention: { hourlyHours: 1, dailyDays: 366, weeklyWeeks: 8, monthlyMonths: 0, deployKeep: 1, manualKeep: 3, preRestoreKeep: 10 },
        });
        expect(normalizeBackupSettings({ intervalMinutes: 1 }).intervalMinutes).toBe(15);
        expect(normalizeBackupSettings({ intervalMinutes: 99999 }).intervalMinutes).toBe(1440);
    });
});

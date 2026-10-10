// "Datensicherung" on the Systemstatus page (#696): three tiles with their light, the button "Jetzt sichern" with its
// answer, the foldable list of snapshots. Never a download.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { BackupPart, BackupStatus } from "../../api";
import BackupSection from "./BackupSection";
import { renderPage } from "../../test/render";
import { switchLang } from "../../test/i18n";
import { t } from "../../i18n";

vi.mock("../../api", async (orig) => ({
    ...(await orig<typeof import("../../api")>()),
    getBackupStatus: vi.fn(),
    runBackupNow: vi.fn(),
}));

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);
const H = 3600 * 1000;

function part(over: Partial<BackupPart> & Pick<BackupPart, "key">): BackupPart {
    return { light: "ok", state: "fresh", at: NOW - 3 * H, ok: true, bytes: 5 * 1024 * 1024, durationMs: 1200, error: "", ...over };
}

export function backupStatus(over: Partial<BackupStatus> = {}): BackupStatus {
    return {
        now: NOW, enabled: true, exists: true, light: "ok", count: 2,
        parts: [
            part({ key: "snapshot" }),
            part({ key: "offsite", at: NOW - 5 * H, bytes: 200 * 1024 * 1024, addedBytes: 3 * 1024 * 1024, durationMs: 40000 }),
            part({ key: "restoreTest", light: "none", state: "never", at: 0, ok: null, bytes: 0, durationMs: 0 }),
        ],
        snapshots: [
            { name: "20261010-090000-hourly", reason: "hourly", at: NOW - 3 * H, bytes: 5 * 1024 * 1024, files: 120, commit: "abc1234", complete: true },
            { name: "20261009-090000-manual", reason: "manual", at: NOW - 27 * H, bytes: 4 * 1024 * 1024, files: 118, commit: "abc1234", complete: true },
        ],
        ...over,
    };
}

beforeEach(() => {
    vi.mocked(api.getBackupStatus).mockResolvedValue(backupStatus());
    vi.mocked(api.runBackupNow).mockReset();
});

async function open() {
    renderPage(<BackupSection />, { route: "/system" });
    await screen.findByText(t("system.backup.parts.snapshot"));
}

const tileOf = (label: string) => screen.getByText(label).closest(".sy-tile") as HTMLElement;

describe("BackupSection", () => {
    it("shows the three parts with time, size and a light in words", async () => {
        await open();
        const snap = tileOf("Schnappschuss");
        expect(within(snap).getByText("vor 3 Std.")).toBeInTheDocument();
        expect(within(snap).getByText(/5 MB/)).toBeInTheDocument();
        expect(within(snap).getByText("In Ordnung")).toBeInTheDocument();
        const off = tileOf("Kopie außer Haus");
        expect(within(off).getByText("vor 5 Std.")).toBeInTheDocument();
        expect(within(off).getByText(/200 MB gesamt, 3 MB neu/)).toBeInTheDocument();
        const probe = tileOf("Wiederherstellungsprobe");
        expect(within(probe).getByText("noch nie")).toBeInTheDocument();
        expect(within(probe).getByText("Unbekannt")).toBeInTheDocument();
        expect(screen.getByText(t("system.backup.crumb.ok"))).toBeInTheDocument();
    });

    it("colours a stale part yellow and a failed one red, with the error spelled out", async () => {
        vi.mocked(api.getBackupStatus).mockResolvedValue(backupStatus({
            light: "bad",
            parts: [
                part({ key: "snapshot", light: "warn", state: "stale", at: NOW - 30 * H }),
                part({ key: "offsite", light: "bad", state: "failed", ok: false, error: "R2 nicht erreichbar" }),
                part({ key: "restoreTest", light: "none", state: "never", at: 0, ok: null, bytes: 0, durationMs: 0 }),
            ],
        }));
        await open();
        expect(tileOf("Schnappschuss")).toHaveClass("sy-tone-mid");
        expect(within(tileOf("Schnappschuss")).getByText("Wird alt")).toBeInTheDocument();
        expect(within(tileOf("Schnappschuss")).getByText("vor 30 Std.")).toBeInTheDocument();
        expect(tileOf("Kopie außer Haus")).toHaveClass("sy-tone-bad");
        expect(within(tileOf("Kopie außer Haus")).getByText("Fehler: R2 nicht erreichbar")).toBeInTheDocument();
        expect(screen.getByText(t("system.backup.crumb.bad"))).toBeInTheDocument();
    });

    it("folds the snapshot list open and names reason and size", async () => {
        await open();
        const toggle = screen.getByRole("button", { name: /2 Schnappschüsse auf diesem Server/ });
        expect(toggle).toHaveAttribute("aria-expanded", "false");
        expect(screen.queryByText("stündlich")).not.toBeInTheDocument();
        await userEvent.click(toggle);
        expect(toggle).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByText("stündlich")).toBeInTheDocument();
        expect(screen.getByText("von Hand")).toBeInTheDocument();
        expect(screen.getByText("4 MB")).toBeInTheDocument();
    });

    it("offers no download of a snapshot", async () => {
        await open();
        await userEvent.click(screen.getByRole("button", { name: /Schnappschüsse auf diesem Server/ }));
        expect(screen.queryByRole("link")).not.toBeInTheDocument();
        expect(screen.queryByText(/herunterladen|download/i)).not.toBeInTheDocument();
    });

    it("takes a snapshot on the button, says how long it took and reloads the status", async () => {
        vi.mocked(api.runBackupNow).mockResolvedValue({ ok: true, skipped: "", name: "n", durationMs: 2300, bytes: 6 * 1024 * 1024, error: "" });
        await open();
        await userEvent.click(screen.getByRole("button", { name: "Jetzt sichern" }));
        expect(api.runBackupNow).toHaveBeenCalledTimes(1);
        expect(await screen.findByRole("status")).toHaveTextContent("Gesichert in 2,3 s: 6 MB.");
        await waitFor(() => expect(api.getBackupStatus).toHaveBeenCalledTimes(2));
    });

    it("says when a backup is already running, and when it failed", async () => {
        vi.mocked(api.runBackupNow).mockResolvedValueOnce({ ok: false, skipped: "locked", name: "", durationMs: 0, bytes: 0, error: "x" });
        await open();
        await userEvent.click(screen.getByRole("button", { name: "Jetzt sichern" }));
        expect(await screen.findByRole("status")).toHaveTextContent(t("system.backup.locked"));
        vi.mocked(api.runBackupNow).mockResolvedValueOnce({ ok: false, skipped: "", name: "", durationMs: 0, bytes: 0, error: "Platte voll" });
        await userEvent.click(screen.getByRole("button", { name: "Jetzt sichern" }));
        await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Sicherung fehlgeschlagen: Platte voll"));
    });

    it("hints that snapshots are off on this instance", async () => {
        vi.mocked(api.getBackupStatus).mockResolvedValue(backupStatus({ enabled: false }));
        await open();
        expect(screen.getByText(/BACKUP_ENABLED=1/)).toBeInTheDocument();
    });

    describe("in English", () => {
        beforeEach(() => switchLang("en"));
        afterEach(() => switchLang("de"));

        it("reads in English too", async () => {
            renderPage(<BackupSection />, { route: "/system" });
            expect(await screen.findByText("Off-site copy")).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Back up now" })).toBeInTheDocument();
            expect(screen.getByText("3 hr ago")).toBeInTheDocument();
        });
    });
});

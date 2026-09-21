// "Log zuordnen": pick a detected log no event owns yet, or paste a Warcraft
// Logs link that was never posted anywhere.
import { useState } from "react";
import { linkLog, linkLogUrl, type ApiError } from "../../../api";
import { useDraftState } from "../../../lib/persistedState";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import Segment from "../../../components/ui/Segment";
import { useToast } from "../../../components/Jobs";
import { useT } from "../../../i18n";
import type { RaidCtx } from "../meta";

type Mode = "detected" | "url";

export default function LogAssignModal({ ctx, open, onClose }: { ctx: RaidCtx; open: boolean; onClose: () => void }) {
    const t = useT();
    const { data, eventId, csrfToken, onChanged } = ctx;
    const unlinked = data.unlinkedLogs;
    const toast = useToast();
    const [mode, setMode] = useState<Mode>(unlinked.length ? "detected" : "url");
    const [picked, setPicked] = useState("");
    const [busy, setBusy] = useState(false);
    // Kept as a draft per event: a pasted link survives a look at another tab.
    const [urlDraft, patchUrlDraft] = useDraftState(`raid-log-url:${eventId}`, { wclUrl: "" });

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            if (mode === "detected") {
                const logId = picked || unlinked[0]?.id;
                if (!logId) return;
                const r = await linkLog(csrfToken, logId, eventId);
                setPicked("");
                onClose();
                onChanged(r.message);
            } else {
                if (!urlDraft.wclUrl.trim()) return;
                const r = await linkLogUrl(csrfToken, urlDraft.wclUrl.trim(), eventId);
                patchUrlDraft({ wclUrl: "" });
                onClose();
                onChanged(r.message);
            }
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const current = picked || unlinked[0]?.id || "";
    return (
        <Modal
            open={open} onClose={onClose} icon="inv_misc_pocketwatch_01" tone="cla"
            kicker={data.event.title} title={t("raidModals.logAssign.title")} width={540}
            hint={t("raidModals.logAssign.hint", { count: unlinked.length })}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="submit" form="rd-log-form" running={busy} disabled={mode === "detected" ? !unlinked.length : !urlDraft.wclUrl.trim()}>{t("raidModals.logAssign.assign")}</Button>
                </>
            )}
        >
            <div className="rd-dlg-stack">
                <Segment<Mode>
                    ariaLabel={t("raidModals.logAssign.source")} size="sm" value={mode} onChange={setMode}
                    options={[{ value: "detected", label: t("raidModals.logAssign.detected"), disabled: !unlinked.length }, { value: "url", label: t("raidModals.logAssign.wclLink") }]}
                />
                <form id="rd-log-form" className="rd-form" onSubmit={submit}>
                    {mode === "detected" ? (
                        <div className="rd-checks" role="radiogroup" aria-label={t("raidModals.logAssign.detectedLogs")}>
                            {unlinked.map((l) => (
                                <label key={l.id} className={`rd-check rd-check-row${current === l.id ? " on" : ""}`}>
                                    <input type="radio" name="rd-log" checked={current === l.id} onChange={() => setPicked(l.id)} />
                                    <span className="rd-grow">{l.title || l.reportId || t("raidModals.logAssign.unknown")}</span>
                                    <span className="rd-mono">{l.reportId}</span>
                                </label>
                            ))}
                        </div>
                    ) : (
                        <div className="field">
                            <label htmlFor="rd-log-url">{t("raidModals.logAssign.urlLabel")}</label>
                            <input
                                id="rd-log-url" type="text" value={urlDraft.wclUrl} onChange={(e) => patchUrlDraft({ wclUrl: e.target.value })}
                                placeholder="https://classic.warcraftlogs.com/reports/abc123…"
                            />
                        </div>
                    )}
                </form>
            </div>
        </Modal>
    );
}

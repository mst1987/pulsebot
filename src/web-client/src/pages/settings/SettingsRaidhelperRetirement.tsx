import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
    getRaidhelperRetirement, importRaidhelperHistory, setRaidhelperDisabled,
    type ApiError, type HistoryImportResult, type RetirementChecklist, type RetirementItem,
} from "../../api";
import {
    disabledSince, headLook, importSummary, itemTip, statusLook, switchState, unmappedText,
} from "../../lib/raidhelperRetirement";
import { useToast } from "../../components/Jobs";
import { Modal, useConfirm } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import IconTile from "../../components/ui/IconTile";
import RaidLoader from "../../components/ui/RaidLoader";
import { ChevronRightIcon } from "../../components/icons";
import { AdminOnlyBadge, CheckMark, WarnIcon } from "../../components/settings/settingsUi";
import { InfoTip } from "../../components/ui/Field";
import { useT } from "../../i18n";

// Einstellungen → Verbindungen → "Umstieg von Raid-Helper" (#291). One compact
// card: a line per checklist item (badge, label, value), everything else — why
// it matters, what exactly is open, the command to run — in the label's tooltip,
// and the one way to fix it as a small link at the line's end. Below, the switch
// that stops every Raid-Helper request; it only opens once the required items are
// done. The spec-history import is a dialog with a dry run first.

function ItemLine({ item, onImport }: { item: RetirementItem; onImport: () => void }) {
    const t = useT();
    const look = statusLook(item.status);
    return (
        <li className={`rhr-item is-${item.status}`} data-item={item.id}>
            <Badge
                tone={look.tone || undefined}
                icon={item.status === "ok" ? <CheckMark /> : item.status === "bad" || item.status === "mid" ? <WarnIcon /> : undefined}
            >
                {look.label}
            </Badge>
            <span className="rhr-label tipped" tabIndex={0} data-tip={item.label} data-tip-sub={itemTip(item)}>
                {item.label}
                {item.required && <span className="rhr-req">{t("settings.retirement.required")}</span>}
            </span>
            <span className="rhr-value">{item.value}</span>
            <span className="rhr-act">
                {item.action === "import" ? (
                    <Button variant="ghost" size="sm" icon="inv_scroll_03" onClick={onImport}>{t("settings.retirement.importAction")}</Button>
                ) : item.link ? (
                    <Link className="rhr-link" to={item.link.to} data-tip={t("settings.retirement.toLink", { label: item.link.label })}>{item.link.label}<ChevronRightIcon /></Link>
                ) : null}
            </span>
        </li>
    );
}

function ImportModal({ open, onClose, onStored }: {
    open: boolean;
    onClose: () => void;
    onStored: () => void;
}) {
    const [perCategory, setPerCategory] = useState(10);
    const [result, setResult] = useState<HistoryImportResult | null>(null);
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const t = useT();

    const run = async (dryRun: boolean) => {
        setBusy(true);
        try {
            const r = await importRaidhelperHistory({ perCategory, dryRun });
            setResult(r);
            if (!dryRun) {
                toast(importSummary(r));
                onStored();
            }
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };
    const close = () => { setResult(null); onClose(); };
    const canStore = !!result && result.dryRun && result.summary.events > 0;

    return (
        <Modal
            open={open}
            onClose={close}
            icon="inv_scroll_03"
            tone="settings"
            kicker={t("settings.retirement.title")}
            title={t("settings.retirement.importTitle")}
            width={620}
            hint={<AdminOnlyBadge />}
            footer={(
                <>
                    <Button variant="ghost" onClick={close} disabled={busy}>{result && !result.dryRun ? t("common.done") : t("common.cancel")}</Button>
                    <Button variant="ghost" onClick={() => run(true)} disabled={busy}>{t("settings.retirement.dryRun")}</Button>
                    <Button onClick={() => run(false)} disabled={busy || !canStore}>{busy ? t("settings.retirement.running") : t("settings.retirement.import")}</Button>
                </>
            )}
        >
            <div className="conn-form">
                <div className="rhr-import-row">
                    <label htmlFor="rhr-per-category">{t("settings.retirement.perCategory")}</label>
                    <input
                        id="rhr-per-category"
                        className="inp-sm"
                        type="number"
                        min={1}
                        max={50}
                        value={perCategory}
                        onChange={(e) => { setPerCategory(Math.max(1, Math.min(50, Math.floor(Number(e.target.value) || 1)))); setResult(null); }}
                    />
                    <InfoTip
                        head={t("settings.retirement.whatHead")}
                        sub={t("settings.retirement.whatSub")}
                    />
                </div>
                {!result ? (
                    <div className="note">{t("settings.retirement.dryFirst")}</div>
                ) : (
                    <>
                        <div className={`conn-status${result.dryRun ? " mid" : ""}`}>
                            <Badge tone={result.dryRun ? "mid" : "ok"} icon={result.dryRun ? undefined : <CheckMark />}>{result.dryRun ? t("settings.retirement.dryRun") : t("settings.retirement.stored")}</Badge>
                            <span>{importSummary(result)}</span>
                        </div>
                        {result.liveError && (
                            <div className="note" data-tip={t("settings.retirement.liveTip")} data-tip-sub={result.liveError}>
                                {t("settings.retirement.liveText")}
                            </div>
                        )}
                        {result.categories.length > 0 && (
                            <ul className="rhr-import-list">
                                {result.categories.map((c) => (
                                    <li key={c.categoryId || "none"}>
                                        <strong>{c.categoryName || c.categoryId || t("settings.retirement.noCategory")}</strong>
                                        <Badge>{t("settings.retirement.events", { count: c.events })}</Badge>
                                        <Badge tone="accent">{t("settings.retirement.entries", { count: c.entries })}</Badge>
                                        {c.skipped > 0 && <Badge tip={t("settings.retirement.skippedTip")} tipSub={t("settings.retirement.skippedSub")}>{t("settings.retirement.skipped", { count: c.skipped })}</Badge>}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {unmappedText(result) && <div className="note">{unmappedText(result)}</div>}
                    </>
                )}
            </div>
        </Modal>
    );
}

export default function RaidhelperRetirementCard() {
    const [list, setList] = useState<RetirementChecklist | null>(null);
    const [error, setError] = useState("");
    const [importing, setImporting] = useState(false);
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const ask = useConfirm();
    const t = useT();

    const load = useCallback(() => {
        getRaidhelperRetirement()
            .then((d) => { setList(d.checklist); setError(""); })
            .catch((err) => setError((err as ApiError).message));
    }, []);
    useEffect(load, [load]);

    const toggle = async () => {
        if (!list) return;
        const off = !list.disabled;
        const ok = await ask(off ? {
            title: t("settings.retirement.offTitle"),
            text: t("settings.retirement.offText"),
            action: t("settings.retirement.offAction"),
            tone: "danger",
        } : {
            title: t("settings.retirement.onTitle"),
            text: t("settings.retirement.onText"),
            action: t("settings.retirement.onAction"),
        });
        if (!ok) return;
        setBusy(true);
        try {
            const d = await setRaidhelperDisabled(off);
            setList(d.checklist);
            toast(off ? t("settings.retirement.toastOff") : t("settings.retirement.toastOn"));
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const head = list ? headLook(list) : null;
    const sw = list ? switchState(list) : null;
    return (
        <section className="conn-card rhr-card" data-conn="raidhelper-retirement">
            <div className="conn-head">
                <IconTile icon="spell_holy_borrowedtime" tone={list && !list.disabled && !list.ready ? "mid" : "settings"} />
                <div className="conn-title">
                    <span>{t("settings.retirement.title")}</span>
                    <InfoTip
                        head={t("settings.retirement.title")}
                        sub={t("settings.retirement.infoSub")}
                    />
                </div>
                {head && <Badge tone={head.tone || undefined} icon={head.tone === "ok" ? <CheckMark /> : undefined}>{head.label}</Badge>}
            </div>
            {!list ? (
                error ? <div className="note rhr-pad">{t("settings.retirement.loadError", { message: error })}</div> : <RaidLoader compact text={t("settings.retirement.loading")} />
            ) : (
                <ul className="rhr-list">
                    {list.items.map((item) => <ItemLine key={item.id} item={item} onImport={() => setImporting(true)} />)}
                </ul>
            )}
            {list && sw && (
                <div className="conn-foot rhr-foot">
                    <label className={`switch${sw.enabled ? "" : " is-disabled"}`} data-tip={list.disabled ? t("settings.retirement.switchedOff") : t("settings.retirement.switchLabel")} data-tip-sub={sw.reason}>
                        <input type="checkbox" checked={sw.checked} disabled={!sw.enabled || busy} onChange={toggle} aria-label={t("settings.retirement.switchLabel")} />
                        <span className="switch-track"><span className="switch-thumb" /></span>
                    </label>
                    <div className="rhr-switch-text">
                        <strong>{t("settings.retirement.switchLabel")}</strong>
                        <span className="note">{list.disabled ? t("settings.retirement.disabledSince", { since: disabledSince(list, Date.now()) }) : sw.enabled ? t("settings.retirement.ready") : sw.reason}</span>
                    </div>
                    <span className="grow" />
                    <AdminOnlyBadge />
                </div>
            )}
            <ImportModal open={importing} onClose={() => setImporting(false)} onStored={load} />
        </section>
    );
}

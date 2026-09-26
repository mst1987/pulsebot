import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
    getRaidhelperRetirement, importRaidhelperHistory, setRaidhelperDisabled,
    type ApiError, type HistoryImportResult, type RetirementChecklist, type RetirementItem,
} from "../api";
import {
    disabledSince, headLook, importSummary, itemTip, statusLook, switchState, unmappedText,
} from "../lib/raidhelperRetirement";
import { useToast } from "./Jobs";
import { Modal, useConfirm } from "./ui/Modal";
import { Button } from "./ui/Button";
import Badge from "./ui/Badge";
import IconTile from "./ui/IconTile";
import RaidLoader from "./ui/RaidLoader";
import { ChevronRightIcon } from "./icons";
import { AdminOnlyBadge, CheckMark, WarnIcon } from "./settingsUi";
import { InfoTip } from "./ui/Field";

// Einstellungen → Verbindungen → "Umstieg von Raid-Helper" (#291). One compact
// card: a line per checklist item (badge, label, value), everything else — why
// it matters, what exactly is open, the command to run — in the label's tooltip,
// and the one way to fix it as a small link at the line's end. Below, the switch
// that stops every Raid-Helper request; it only opens once the required items are
// done. The spec-history import is a dialog with a dry run first.

function ItemLine({ item, onImport }: { item: RetirementItem; onImport: () => void }) {
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
                {item.required && <span className="rhr-req">Pflicht</span>}
            </span>
            <span className="rhr-value">{item.value}</span>
            <span className="rhr-act">
                {item.action === "import" ? (
                    <Button variant="ghost" size="sm" icon="inv_scroll_03" onClick={onImport}>Importieren …</Button>
                ) : item.link ? (
                    <Link className="rhr-link" to={item.link.to} data-tip={`Zu ${item.link.label}`}>{item.link.label}<ChevronRightIcon /></Link>
                ) : null}
            </span>
        </li>
    );
}

function ImportModal({ open, csrfToken, onClose, onStored }: {
    open: boolean;
    csrfToken: string | null;
    onClose: () => void;
    onStored: () => void;
}) {
    const [perCategory, setPerCategory] = useState(10);
    const [result, setResult] = useState<HistoryImportResult | null>(null);
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    const run = async (dryRun: boolean) => {
        setBusy(true);
        try {
            const r = await importRaidhelperHistory(csrfToken, { perCategory, dryRun });
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
            kicker="Umstieg von Raid-Helper"
            title="Spec-Historie importieren"
            width={620}
            hint={<AdminOnlyBadge />}
            footer={(
                <>
                    <Button variant="ghost" onClick={close} disabled={busy}>{result && !result.dryRun ? "Fertig" : "Abbrechen"}</Button>
                    <Button variant="ghost" onClick={() => run(true)} disabled={busy}>Probelauf</Button>
                    <Button onClick={() => run(false)} disabled={busy || !canStore}>{busy ? "Läuft…" : "Importieren"}</Button>
                </>
            )}
        >
            <div className="conn-form">
                <div className="rhr-import-row">
                    <label htmlFor="rhr-per-category">Letzte Events je Kategorie</label>
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
                        head="Was importiert wird"
                        sub="Nur wer sich mit welcher Spec angemeldet hat – keine Events, keine Anmeldungen. Daraus schlagen die Ein-Klick-Anmeldung und das Profil die zuletzt gespielte Spec vor. Ein Event wird nie doppelt gezählt; ein zweiter Import holt nur neue Raids."
                    />
                </div>
                {!result ? (
                    <div className="note">Erst der Probelauf zeigt, was gespeichert würde. Gespeichert wird erst mit „Importieren“.</div>
                ) : (
                    <>
                        <div className={`conn-status${result.dryRun ? " mid" : ""}`}>
                            <Badge tone={result.dryRun ? "mid" : "ok"} icon={result.dryRun ? undefined : <CheckMark />}>{result.dryRun ? "Probelauf" : "gespeichert"}</Badge>
                            <span>{importSummary(result)}</span>
                        </div>
                        {result.liveError && (
                            <div className="note" data-tip="Raid-Helper nicht abgefragt" data-tip-sub={result.liveError}>
                                Raid-Helper antwortet nicht – nur die gespeicherten Events wurden gelesen.
                            </div>
                        )}
                        {result.categories.length > 0 && (
                            <ul className="rhr-import-list">
                                {result.categories.map((c) => (
                                    <li key={c.categoryId || "none"}>
                                        <strong>{c.categoryName || c.categoryId || "Ohne Kategorie"}</strong>
                                        <Badge>{c.events} {c.events === 1 ? "Event" : "Events"}</Badge>
                                        <Badge tone="accent">{c.entries} Einträge</Badge>
                                        {c.skipped > 0 && <Badge tip="Schon importiert" tipSub="Diese Events wurden bei einem früheren Import gezählt und werden übersprungen.">{c.skipped} schon da</Badge>}
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

export default function RaidhelperRetirementCard({ csrfToken }: { csrfToken: string | null }) {
    const [list, setList] = useState<RetirementChecklist | null>(null);
    const [error, setError] = useState("");
    const [importing, setImporting] = useState(false);
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const ask = useConfirm();

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
            title: "Raid-Helper abschalten?",
            text: "Der EventHelper fragt Raid-Helper danach nicht mehr ab: keine neuen Raid-Helper-Events, keine Anmeldungen, kein Scan. Vergangene Raids bleiben mit ihren gespeicherten Anmeldungen lesbar. Wieder einschalten geht jederzeit.",
            action: "Abschalten",
            tone: "danger",
        } : {
            title: "Raid-Helper wieder einschalten?",
            text: "Events, Anmeldungen und der Scan laufen dann wieder über Raid-Helper.",
            action: "Einschalten",
        });
        if (!ok) return;
        setBusy(true);
        try {
            const d = await setRaidhelperDisabled(csrfToken, off);
            setList(d.checklist);
            toast(off ? "Raid-Helper abgeschaltet." : "Raid-Helper wieder eingeschaltet.");
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
                    <span>Umstieg von Raid-Helper</span>
                    <InfoTip
                        head="Umstieg von Raid-Helper"
                        sub="Was erledigt sein sollte, bevor der EventHelper Raid-Helper ganz ersetzt. Die zwei Pflichtpunkte schalten den Schalter unten frei; der Rest macht den Alltag der Raider leichter. Jeder Punkt erklärt sich im Tooltip seines Namens."
                    />
                </div>
                {head && <Badge tone={head.tone || undefined} icon={head.tone === "ok" ? <CheckMark /> : undefined}>{head.label}</Badge>}
            </div>
            {!list ? (
                error ? <div className="note rhr-pad">Checkliste nicht ladbar: {error}</div> : <RaidLoader compact text="Checkliste wird geprüft" />
            ) : (
                <ul className="rhr-list">
                    {list.items.map((item) => <ItemLine key={item.id} item={item} onImport={() => setImporting(true)} />)}
                </ul>
            )}
            {list && sw && (
                <div className="conn-foot rhr-foot">
                    <label className={`switch${sw.enabled ? "" : " is-disabled"}`} data-tip={list.disabled ? "Abgeschaltet" : "Raid-Helper-Abfragen abschalten"} data-tip-sub={sw.reason}>
                        <input type="checkbox" checked={sw.checked} disabled={!sw.enabled || busy} onChange={toggle} aria-label="Raid-Helper-Abfragen abschalten" />
                        <span className="switch-track"><span className="switch-thumb" /></span>
                    </label>
                    <div className="rhr-switch-text">
                        <strong>Raid-Helper-Abfragen abschalten</strong>
                        <span className="note">{list.disabled ? `abgeschaltet ${disabledSince(list, Date.now())}` : sw.enabled ? "bereit – Historie bleibt lesbar" : sw.reason}</span>
                    </div>
                    <span className="grow" />
                    <AdminOnlyBadge />
                </div>
            )}
            <ImportModal open={importing} csrfToken={csrfToken} onClose={() => setImporting(false)} onStored={load} />
        </section>
    );
}

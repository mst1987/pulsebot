import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
    getClaData, createReport, evalLog, resetEval, scanLogs, deleteLogEntry, linkLog, unlinkLog, autoMatchLogs,
    deleteReport,
    type ApiError, type ClaFilter, type ClaRow, type ClaRaid, type LogSection, type MatchCandidate } from "../api";
import { useApi } from "../hooks/useApi";
import { formatEventTime } from "../lib/format";
import { withIncompleteConfirm } from "../lib/confirmIncomplete";
import { usePersistedState, usePersistedSearchParam, useDraftState } from "../lib/persistedState";
import { raidCount, raidIcon, raidTip } from "../lib/logRaids";
import { SortLabel, ariaSort } from "../components/SortTh";
import { useJobs } from "../components/Jobs";
import Pager from "../components/Pager";
import { CheckIcon, ExternalIcon, TrashIcon } from "../components/icons";
import { useConfirm, Modal } from "../components/ui/Modal";
import { Button, IconButton, buttonClass } from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import PageHead from "../components/ui/PageHead";
import Tip from "../components/ui/Tip";
import WowIcon from "../components/ui/WowIcon";
import "../styles/log-auswertung.css";
import RaidLoader from "../components/ui/RaidLoader";
import { useDismiss } from "../hooks/useDismiss";

// Log-Auswertung (design issue #217): one list, one row per log. What used to be
// two tabs ("Auswertungen" / "Erkannte Logs") showing the same log twice is now
// one list with a filter segment; the link form, the assignment and the
// "raid still running" question are modals; each row has exactly one action
// plus a row menu for everything that is needed rarely.

type Dir = "asc" | "desc";

const FILTERS: ClaFilter[] = ["all", "open", "unlinked", "done"];

// Rough runtimes, used only to give the progress toast a bar to fill. RPB walks
// the whole fight timeline and is the slow half; a report built from a pasted
// link is a full CLA run.
const EVAL_SECONDS: Record<LogSection, number> = { cla: 25, rpb: 55 };
const REPORT_SECONDS = 30;

// What a pasted link builds: both halves unless the dialog says otherwise.
type SectionChoice = "both" | "cla" | "rpb";
const SECTION_CHOICES: { key: SectionChoice; label: string; sub: string; icon: string; seconds: number; sections: LogSection[] }[] = [
    { key: "both", label: "CLA + RPB", sub: "Komplette Auswertung auf einer Report-Seite", icon: "inv_misc_book_09", seconds: EVAL_SECONDS.cla + EVAL_SECONDS.rpb, sections: ["cla", "rpb"] },
    { key: "cla", label: "nur CLA", sub: "Gear, Consumables, Kampfverlauf", icon: "inv_chest_cloth_43", seconds: REPORT_SECONDS, sections: ["cla"] },
    { key: "rpb", label: "nur RPB", sub: "Schaden, Tode, Aktivität, Cooldowns", icon: "ability_warrior_offensivestance", seconds: EVAL_SECONDS.rpb, sections: ["rpb"] },
];

// The two halves of an analysis — label, icon and what each one looks at.
const ANALYSES: { key: LogSection; label: string; icon: string; sub: string }[] = [
    { key: "cla", label: "CLA", icon: "inv_chest_cloth_43", sub: "Gear, Verzauberungen, Sockel, Consumables, Drums, Potions & Shadow-Resi" },
    { key: "rpb", label: "RPB", icon: "ability_warrior_offensivestance", sub: "Vermeidbarer Schaden, Tode, Aktivität, Cooldowns, Interrupts & Log-Prüfung" },
];

// Default direction per sortable column.
const SORT_DEFAULTS: Record<string, Dir> = { date: "desc", content: "asc", status: "asc", event: "asc" };
type Sorting = { sort: string; dir: Dir };
const SORTING_DEFAULT: Sorting = { sort: "date", dir: "desc" };

const FILTER_META: Record<ClaFilter, { label: string; tip: string; sub: string; empty: string }> = {
    all: {
        label: "Alle",
        tip: "Alle Logs",
        sub: "Vom Bot im Log-Channel erkannte Warcraft-Logs und per Link ausgewertete Reports, neueste Post-Zeit zuerst. Jeder Report wird nur einmal ausgewertet.",
        empty: "Noch keine Logs. Sobald im Log-Channel ein Warcraft-Logs-Link gepostet wird, taucht er hier auf.",
    },
    open: {
        label: "Offen",
        tip: "Noch nicht ausgewertet",
        sub: "Logs, für die weder CLA noch RPB gelaufen ist. Über den Log-Link vorab prüfen, dann „Auswerten“.",
        empty: "Kein Log wartet auf eine Auswertung.",
    },
    unlinked: {
        label: "Ohne Raid-Event",
        tip: "Keinem Raid-Event zugeordnet",
        sub: "Jedes Log gehört zu dem Raid, dessen Startzeit zur Post-Zeit passt. Der Vorschlag ist im Zuordnen-Dialog vorgewählt.",
        empty: "Alle Logs sind einem Raid-Event zugeordnet.",
    },
    done: {
        label: "Ausgewertet",
        tip: "Mindestens eine Hälfte ausgewertet",
        sub: "Logs mit CLA- oder RPB-Auswertung und die per Link erstellten Reports.",
        empty: "Noch keine Auswertungen.",
    },
};

// ---- small formatting helpers ----

const TZ = "Europe/Berlin";

/** "So 14.09. 21:58" (epoch ms). */
function fmtPosted(ms: number): string {
    if (!ms) return "";
    const d = new Date(ms);
    const wd = d.toLocaleString("de-DE", { timeZone: TZ, weekday: "short" }).replace(".", "");
    const day = d.toLocaleString("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit" });
    const time = d.toLocaleString("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
    return `${wd} ${day.endsWith(".") ? day : `${day}.`} ${time}`;
}

/** "Do 11.09." (event start in seconds). */
function fmtEventDay(startTime: number): string {
    if (!startTime) return "";
    const d = new Date(startTime * 1000);
    const wd = d.toLocaleString("de-DE", { timeZone: TZ, weekday: "short" }).replace(".", "");
    const day = d.toLocaleString("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit" });
    return `${wd} ${day.endsWith(".") ? day : `${day}.`}`;
}

/** "2 h 13 min nach Start" — how far a log's post lies from an event's start. */
function formatMatchOffset(diffMs: number): string {
    const ms = Number(diffMs) || 0;
    const mins = Math.round(Math.abs(ms) / 60000);
    const hours = Math.floor(mins / 60);
    const rest = mins % 60;
    const span = hours ? `${hours} h${rest ? ` ${rest} min` : ""}` : `${mins} min`;
    if (mins === 0) return "pünktlich zum Start";
    return ms >= 0 ? `${span} nach Start` : `${span} vor Start`;
}

function discordUrl(row: ClaRow): string {
    return row.guildId && row.channelId && row.messageId
        ? `https://discord.com/channels/${row.guildId}/${row.channelId}/${row.messageId}`
        : "";
}

// Line icons for pure UI functions that components/icons.tsx does not carry.
function DotsIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="19" cy="12" r="1.9" />
        </svg>
    );
}
function UndoIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
        </svg>
    );
}
function QuestionIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 7v6" /><circle cx="12" cy="17" r=".6" />
        </svg>
    );
}

// ---- the filter segment with a count per option ----

/**
 * The shared Segment's look (.seg / .seg-opt) with a round count badge per
 * option — the shared component takes plain string labels, so the counts
 * would not fit into it.
 */
function FilterSegment({ value, counts, onChange }: {
    value: ClaFilter;
    counts: Record<ClaFilter, number>;
    onChange: (f: ClaFilter) => void;
}) {
    return (
        <div className="seg la-seg" role="radiogroup" aria-label="Logs filtern">
            {FILTERS.map((f) => {
                const active = f === value;
                const warn = (f === "open" || f === "unlinked") && counts[f] > 0;
                return (
                    <button
                        key={f}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={`seg-opt${active ? " active" : ""}`}
                        data-tip={FILTER_META[f].tip}
                        data-tip-sub={FILTER_META[f].sub}
                        onClick={() => onChange(f)}
                    >
                        {FILTER_META[f].label}
                        <Badge count tone={warn ? "mid" : undefined}>{counts[f] ?? 0}</Badge>
                    </button>
                );
            })}
        </div>
    );
}

// ---- row menu ----

type MenuItem = { id: string; label: string; icon: ReactNode; onSelect?: () => void; href?: string; external?: boolean; danger?: boolean } | "sep";

/** "⋯" icon button with a popover of the row's rarely needed actions. */
function RowMenu({ items, label }: { items: MenuItem[]; label: string }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useDismiss(ref, open, () => setOpen(false));

    // no separator at the start, the end, or twice in a row
    const clean = items.filter((it, i, all) => it !== "sep" || (i > 0 && i < all.length - 1 && all[i - 1] !== "sep"));

    return (
        <div className="la-menu" ref={ref}>
            <IconButton
                icon={<DotsIcon />} tip="Weitere Aktionen" size="sm" aria-label={label}
                aria-haspopup="menu" aria-expanded={open}
                className={open ? "on" : undefined}
                onClick={() => setOpen((o) => !o)}
            />
            {open && (
                <div className="la-menu-pop" role="menu">
                    {clean.map((it, i) => {
                        if (it === "sep") return <div key={`sep-${i}`} className="la-msep" role="separator" />;
                        const cls = `la-mi${it.danger ? " danger" : ""}`;
                        return it.href
                            ? (
                                <a
                                    key={it.id} role="menuitem" className={cls} href={it.href}
                                    {...(it.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                                    onClick={() => setOpen(false)}
                                >{it.icon}{it.label}</a>
                            )
                            : (
                                <button key={it.id} type="button" role="menuitem" className={cls} onClick={() => { setOpen(false); it.onSelect?.(); }}>
                                    {it.icon}{it.label}
                                </button>
                            );
                    })}
                </div>
            )}
        </div>
    );
}

// ---- Modal "Neue Auswertung" ----

/**
 * Paste a Warcraft-Logs link, pick CLA + RPB (or one half), go. The build runs
 * as a background job — the dialog closes at once and the toast at the bottom
 * reports progress and the finished report. The link stays a draft until then.
 */
function NewEvaluationDialog({ open, onClose, onChanged }: {
    open: boolean;
    onClose: () => void;
    onChanged: () => void;
}) {
    const ask = useConfirm();
    const jobs = useJobs();
    const [draft, patchDraft, clearDraft] = useDraftState("cla-report-link", { link: "", sections: "both" as SectionChoice });
    const link = draft.link;
    const choice = SECTION_CHOICES.find((c) => c.key === draft.sections) || SECTION_CHOICES[0];

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        const target = link.trim();
        if (!target) return;
        clearDraft();
        onClose();
        jobs.run({
            label: `${choice.key === "both" ? "CLA + RPB" : choice.label.replace("nur ", "")}-Auswertung`,
            detail: target,
            expectedSeconds: choice.seconds,
            describe: (r) => ({
                message: "Auswertung erstellt.",
                link: { href: r.url, label: "Report ansehen", external: true },
            }),
        }, () => withIncompleteConfirm(ask, (force) => createReport(target, { force, sections: choice.sections }))).then(onChanged);
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            icon="inv_misc_spyglass_02"
            tone="cla"
            kicker="Warcraft-Logs-Report per Link"
            title="Neue Auswertung"
            width={700}
            initialFocus="#la-link"
            hint="Läuft im Hintergrund – Fortschritt unten in der Mitte."
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button type="submit" form="la-new-eval" icon="inv_misc_pocketwatch_01" disabled={!link.trim()}>Auswerten</Button>
                </>
            )}
        >
            <form id="la-new-eval" className="la-form" onSubmit={submit}>
                <div>
                    <label className="la-lbl" htmlFor="la-link">
                        Report-Link oder Report-ID
                        <Tip
                            className="la-qm"
                            head="Report-Link oder -ID"
                            sub="Der Link aus Warcraft Logs oder nur die ID dahinter. Vom Bot erkannte Logs stehen schon in der Liste und lassen sich dort direkt auswerten."
                        >?</Tip>
                    </label>
                    <input
                        id="la-link" className="la-input" type="text" value={link}
                        onChange={(e) => patchDraft({ link: e.target.value })}
                        placeholder="https://classic.warcraftlogs.com/reports/abc123…" required
                    />
                </div>
                <div>
                    <div className="la-lbl" id="la-opts-lbl">Welche Analysen</div>
                    <div className="la-opts" role="radiogroup" aria-labelledby="la-opts-lbl">
                        {SECTION_CHOICES.map((c) => {
                            const on = choice.key === c.key;
                            return (
                                <button
                                    key={c.key} type="button" role="radio" aria-checked={on}
                                    className={`la-opt${on ? " on" : ""}`}
                                    onClick={() => patchDraft({ sections: c.key })}
                                >
                                    <span className="la-opt-top">
                                        <WowIcon name={c.icon} size={36} />
                                        <b>{c.label}</b>
                                        <span className={`la-radio${on ? " on" : ""}`} aria-hidden="true" />
                                    </span>
                                    <span className="la-opt-sub">{c.sub}</span>
                                    <span><Badge>≈ {c.seconds} s</Badge></span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </form>
        </Modal>
    );
}

// ---- Modal "Raid-Event zuordnen" ----

function AssignDialog({ row, onClose, onAssign, onUnlink }: {
    row: ClaRow | null;
    onClose: () => void;
    onAssign: (row: ClaRow, eventId: string) => void;
    onUnlink: (row: ClaRow) => void;
}) {
    const cands: MatchCandidate[] = row?.candidates || [];
    const [picked, setPicked] = useState("");
    useEffect(() => {
        if (!row) return;
        const current = cands.find((c) => c.eventId === row.eventId);
        setPicked(current ? current.eventId : (cands[0]?.eventId || ""));
        // re-pick only when another row opens the dialog
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [row?.id]);

    const nearest = cands.length ? Math.min(...cands.map((c) => Math.abs(c.diffMs))) : 0;

    return (
        <Modal
            open={!!row}
            onClose={onClose}
            icon="inv_misc_note_02"
            kicker={row ? `${row.title} · gepostet ${fmtPosted(row.postedAt)}` : ""}
            title="Raid-Event zuordnen"
            width={720}
            hint={row?.eventId ? undefined : "Zuordnung jederzeit über das Zeilenmenü änderbar."}
            footer={row && (
                <>
                    {row.eventId && (
                        <Button variant="danger" icon={<TrashIcon />} className="la-foot-left" onClick={() => onUnlink(row)}>Zuordnung entfernen</Button>
                    )}
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button icon="inv_misc_note_02" disabled={!picked || picked === row.eventId} onClick={() => onAssign(row, picked)}>Zuordnen</Button>
                </>
            )}
        >
            {row && (
                <div className="la-assign">
                    {row.eventId && (
                        <div className="la-assign-now">
                            <Badge tone="accent" icon="inv_misc_note_02" className="plain">
                                {row.eventLabel || row.eventId}{row.eventStartTime ? ` · ${fmtEventDay(row.eventStartTime)}` : ""}
                            </Badge>
                            <span className="la-muted">ist zugeordnet ({row.eventLinkSource === "auto" ? "automatisch" : "manuell"})</span>
                        </div>
                    )}
                    {row.matchAmbiguous && cands.length > 1 && (
                        <div className="la-assign-now">
                            <Badge tone="mid" icon={<QuestionIcon />}>{cands.length} Events passen</Badge>
                            <span className="la-muted">nach Nähe zur Post-Zeit sortiert – der erste ist vorgewählt</span>
                        </div>
                    )}
                    {cands.length
                        ? (
                            <div className="la-cands" role="radiogroup" aria-label="Passende Raid-Events">
                                {cands.map((c) => {
                                    const on = picked === c.eventId;
                                    return (
                                        <button
                                            key={c.eventId} type="button" role="radio" aria-checked={on}
                                            className={`la-cand${on ? " on" : ""}`}
                                            onClick={() => setPicked(c.eventId)}
                                        >
                                            <span className={`la-radio${on ? " on" : ""}`} aria-hidden="true" />
                                            <WowIcon name={raidIcon(c.contentId)} size={36} className="la-zicon" />
                                            <span className="la-cell-main">
                                                <span className="la-title">{c.title || c.eventId}</span>
                                                <span className="la-meta">{formatEventTime(c.startTime)}{c.categoryName ? ` · ${c.categoryName}` : ""}</span>
                                            </span>
                                            <span className="la-badges la-badges-end">
                                                <Badge tone={Math.abs(c.diffMs) === nearest ? "ok" : "mid"} icon="spell_holy_borrowedtime">{formatMatchOffset(c.diffMs)}</Badge>
                                                {c.sameCategory && <Badge tone="accent" className="plain">gleiche Kategorie</Badge>}
                                                {c.eventId === row.eventId && <Badge className="plain">aktuell</Badge>}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )
                        : <p className="la-muted">Kein Raid-Event mit passender Startzeit gefunden.</p>}
                </div>
            )}
        </Modal>
    );
}

// ---- one list row ----

function RaidBadges({ row }: { row: ClaRow }) {
    if (!row.raids.length) {
        return row.zone
            ? <Badge className="plain" tip={row.zone} tipSub="Die Bosse dieses Logs sind noch nicht gelesen.">{row.zone}</Badge>
            : <Badge className="plain" tip="Inhalt unbekannt" tipSub="Warcraft Logs hat die Kampfliste noch nicht geliefert – sie wird beim nächsten Laden erneut abgefragt.">–</Badge>;
    }
    return (
        <>
            {row.raids.map((r: ClaRaid) => {
                const tip = raidTip(r);
                return (
                    <Badge key={r.contentId} tone={r.finalKilled ? "ok" : "mid"} icon={raidIcon(r.contentId)} tip={tip.head} tipSub={tip.sub}>
                        {raidCount(r)}
                    </Badge>
                );
            })}
        </>
    );
}

function EvalBadges({ row, running }: { row: ClaRow; running: LogSection[] }) {
    const r = row.report;
    const stats = r && r.generatedAt
        ? `${fmtPosted(r.generatedAt)} · ${r.playerCount} Spieler · ${r.issueCount} Probleme`
        : "";
    const anyDone = row.sections.length > 0;
    const badges = ANALYSES.flatMap((a) => {
        if (running.includes(a.key)) {
            return [<Badge key={a.key} tone="accent" icon={<span className="btn-spin" aria-hidden="true" />} tip={`${a.label} läuft`} tipSub="Fortschritt im Hinweis unten in der Mitte.">{a.label} läuft</Badge>];
        }
        if (row.sections.includes(a.key)) {
            return [<Badge key={a.key} tone="ok" icon={<CheckIcon />} tip={`${a.label} ausgewertet`} tipSub={stats || a.sub}>{a.label}</Badge>];
        }
        // the missing half of a log that is half done; a link report cannot be completed
        if (anyDone && row.kind === "log") {
            return [<Badge key={a.key} tip={`${a.label} offen`} tipSub={a.sub}>{a.label} offen</Badge>];
        }
        return [];
    });
    if (!badges.length) {
        return <Badge tip="Noch nicht ausgewertet" tipSub="„Auswerten“ startet CLA und RPB nacheinander, beide landen auf einer Report-Seite.">offen</Badge>;
    }
    return <>{badges}</>;
}

function EventCell({ row, eventsError, onAssign }: { row: ClaRow; eventsError: string | null; onAssign: () => void }) {
    if (row.eventId) {
        const when = row.eventStartTime ? formatEventTime(row.eventStartTime) : "";
        return (
            <Badge
                tone="accent" icon="inv_misc_note_02" className="plain la-event"
                tip={row.eventLabel || "Raid-Event"}
                tipSub={`${when ? `Start ${when} · ` : ""}${row.eventLinkSource === "auto" ? "automatisch zugeordnet" : "manuell zugeordnet"}. Ändern über das Zeilenmenü.`}
            >
                {row.eventLabel || row.eventId}{row.eventStartTime ? ` · ${fmtEventDay(row.eventStartTime)}` : ""}
            </Badge>
        );
    }
    if (row.kind === "report") {
        return <Badge className="plain" tip="Ohne Log nicht zuordenbar" tipSub="Dieser Report wurde per Link erstellt. Zugeordnet wird ein Log – postet den Link im Log-Channel, dann erscheint er als Log.">ohne Log</Badge>;
    }
    if (eventsError) {
        return <Badge tone="bad" className="plain" tip="Raid-Events nicht geladen" tipSub={eventsError}>Events fehlen</Badge>;
    }
    const cands = row.candidates || [];
    if (!cands.length) {
        return <Badge className="plain" tip="Kein passendes Event" tipSub="Kein Raid-Event hat eine Startzeit, die zur Post-Zeit dieses Logs passt.">kein passendes Event</Badge>;
    }
    return (
        <Button
            variant="ghost" size="sm" icon="inv_misc_note_02" onClick={onAssign}
            data-tip={row.matchAmbiguous ? "Mehrere Events passen" : "Passendes Event gefunden"}
            data-tip-sub={row.matchAmbiguous ? "Die Startzeiten liegen nah beieinander – bitte prüfen." : `${cands[0].title} · ${formatMatchOffset(cands[0].diffMs)}`}
        >
            Zuordnen <Badge count tone={row.matchAmbiguous ? "mid" : undefined}>{cands.length}</Badge>
        </Button>
    );
}

function ListRow({ row, running, eventsError, onEvaluate, onAssign, onReset, onDeleteLog, onDeleteReport }: {
    row: ClaRow;
    running: LogSection[];
    eventsError: string | null;
    onEvaluate: (section: LogSection | "both") => void;
    onAssign: () => void;
    onReset: (section: LogSection) => void;
    onDeleteLog: () => void;
    onDeleteReport: () => void;
}) {
    const icon = raidIcon(row.raids[0]?.contentId);
    const missing = ANALYSES.filter((a) => !row.sections.includes(a.key));
    const discord = discordUrl(row);
    const where = [row.categoryName, row.channelName ? `#${row.channelName}` : ""].filter(Boolean).join(" · ");

    let action: ReactNode;
    if (running.length) {
        action = <Button variant="run" size="sm" running>läuft</Button>;
    } else if (row.kind === "log" && !row.sections.length) {
        action = (
            <Button variant="run" size="sm" icon="inv_misc_pocketwatch_01" data-tip="CLA + RPB auswerten" data-tip-sub="Beide Hälften nacheinander, eine Report-Seite." onClick={() => onEvaluate("both")}>
                Auswerten
            </Button>
        );
    } else if (row.kind === "log" && missing.length) {
        const a = missing[0];
        action = (
            <Button variant="run" size="sm" icon={a.icon} data-tip={`${a.label} auswerten`} data-tip-sub={a.sub} onClick={() => onEvaluate(a.key)}>
                {a.label}
            </Button>
        );
    } else if (row.report) {
        action = <a className={buttonClass("ghost", "sm", true)} href={row.report.url}><WowIcon name="inv_scroll_03" size={18} />Report</a>;
    }

    const items: MenuItem[] = [
        ...(row.report ? [{ id: "report", label: "Report öffnen", icon: <WowIcon name="inv_scroll_03" size={20} />, href: row.report.url }] : []),
        ...(row.wclUrl ? [{ id: "wcl", label: "Log bei Warcraft Logs", icon: <ExternalIcon />, href: row.wclUrl, external: true }] : []),
        ...(discord ? [{ id: "msg", label: "Nachricht im Log-Channel", icon: <WowIcon name="inv_letter_15" size={20} />, href: discord, external: true }] : []),
        "sep",
        ...(row.kind === "log"
            ? [{ id: "assign", label: row.eventId ? "Zuordnung ändern" : "Raid-Event zuordnen", icon: <WowIcon name="inv_misc_note_02" size={20} />, onSelect: onAssign }]
            : []),
        ...(row.kind === "log"
            ? ANALYSES.filter((a) => row.sections.includes(a.key)).map((a) => ({ id: `reset-${a.key}`, label: `${a.label}-Auswertung verwerfen`, icon: <UndoIcon />, onSelect: () => onReset(a.key) }))
            : []),
        "sep",
        row.kind === "log"
            ? { id: "delete", label: "Aus der Liste löschen", icon: <TrashIcon />, onSelect: onDeleteLog, danger: true }
            : { id: "delete", label: "Auswertung löschen", icon: <TrashIcon />, onSelect: onDeleteReport, danger: true },
    ];

    return (
        <div className={`la-row${running.length ? " running" : ""}`} role="row">
            <WowIcon name={icon} size={36} className="la-zicon" />
            <div className="la-cell-main" role="cell">
                <span className="la-title" data-tip={row.title} data-tip-sub={where || (row.source === "link" ? "Per Link ausgewertet" : undefined)}>{row.title || row.reportId}</span>
                <span className="la-meta">
                    {fmtPosted(row.postedAt)}
                    {row.source === "channel"
                        ? <>{" · "}<WowIcon name="inv_letter_15" size={14} />{row.channelName ? `#${row.channelName}` : "Log-Channel"}</>
                        : <>{" · "}<ExternalIcon />Link</>}
                </span>
            </div>
            <div className="la-badges" role="cell" data-label="Inhalt"><RaidBadges row={row} /></div>
            <div className="la-badges" role="cell" data-label="Auswertung"><EvalBadges row={row} running={running} /></div>
            <div className="la-badges" role="cell" data-label="Raid-Event"><EventCell row={row} eventsError={eventsError} onAssign={onAssign} /></div>
            <div className="la-actions" role="cell">
                {action}
                <RowMenu items={items} label={`Weitere Aktionen für „${row.title || row.reportId}“`} />
            </div>
        </div>
    );
}

// ---- the page ----

export default function ClaPage() {
    const ask = useConfirm();
    const jobs = useJobs();
    const [searchParams, setSearchParams] = useSearchParams();
    const [filter, setFilter] = usePersistedSearchParam<ClaFilter>("cla-filter", "filter", "all", FILTERS);
    const [sorting, setSorting] = usePersistedState<Sorting>("cla-sort", SORTING_DEFAULT);
    const [newOpen, setNewOpen] = useState(false);
    const [assignRow, setAssignRow] = useState<ClaRow | null>(null);
    const [scanning, setScanning] = useState(false);
    const [automatching, setAutomatching] = useState(false);
    // "<logId>:<section>" for every analysis started here that is still going.
    // Purely cosmetic and page-local — the job itself lives in JobsProvider.
    const [running, setRunning] = useState<string[]>([]);

    // Old links (?view=logs / ?view=reports from the two-tab page) open the full list.
    useEffect(() => {
        if (!searchParams.has("view")) return;
        const next = new URLSearchParams(searchParams);
        next.delete("view");
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams]);

    // An explicit ?sort/?dir wins; without one the remembered sort applies. Both are
    // checked against the columns that exist, so a value stored by the old two-tab
    // page (a different shape) cannot ask the API to sort by nothing.
    const remembered = sorting && typeof sorting.sort === "string" && SORT_DEFAULTS[sorting.sort] ? sorting : SORTING_DEFAULT;
    const sortParam = searchParams.get("sort") || "";
    const sort = SORT_DEFAULTS[sortParam] ? sortParam : remembered.sort;
    const dirParam = searchParams.get("dir");
    const dir: Dir = dirParam ? (dirParam === "asc" ? "asc" : "desc") : (remembered.dir === "asc" ? "asc" : "desc");
    // The page number is deliberately not remembered: the list grows at the top.
    const page = Math.max(1, Number(searchParams.get("page")) || 1);

    const cla = useApi(() => getClaData(filter, sort, dir, page), [filter, sort, dir, page]);
    const { data } = cla;

    const switchFilter = (f: ClaFilter) => setFilter(f, (p) => { p.delete("page"); });

    const sortBy = (key: string) => {
        const nextDir: Dir = sort === key ? (dir === "asc" ? "desc" : "asc") : (SORT_DEFAULTS[key] || "desc");
        setSorting({ sort: key, dir: nextDir });
        setFilter(filter, (p) => { p.set("sort", key); p.set("dir", nextDir); p.set("page", "1"); });
    };

    const goToPage = (p: number) => {
        const next = new URLSearchParams(searchParams);
        next.set("page", String(p));
        setSearchParams(next);
    };

    /** Run a short action, report its outcome as a toast, then refresh the list. */
    const quick = async (fn: () => Promise<{ message: string }>, setBusy?: (b: boolean) => void) => {
        if (setBusy) setBusy(true);
        try {
            const r = await fn();
            jobs.notify(r.message);
        } catch (err) {
            jobs.notify((err as ApiError).message, "err");
        } finally {
            if (setBusy) setBusy(false);
            cla.reload();
        }
    };

    const scan = () => quick(() => scanLogs(), setScanning);
    const automatch = () => quick(() => autoMatchLogs(), setAutomatching);

    // Hands the evaluation to JobsProvider: it runs server-side either way, but
    // owning the promise up there is what lets the admin leave this page while
    // the toast keeps reporting.
    const evaluate = (row: ClaRow, section: LogSection | "both") => {
        if (section === "both") return evaluateBoth(row);
        const label = section.toUpperCase();
        const key = `${row.logId}:${section}`;
        setRunning((keys) => [...keys, key]);
        jobs.run({
            label: `${label}-Auswertung`,
            detail: row.title || row.reportId,
            expectedSeconds: EVAL_SECONDS[section],
            describe: (r) => ({
                message: r.alreadyEvaluated ? `${label}-Auswertung lag bereits vor.` : `${label}-Auswertung erstellt.`,
                link: r.url ? { href: r.url, label: "Report ansehen", external: true } : undefined,
            }),
        }, () => withIncompleteConfirm(ask, (force) => evalLog(row.logId, section, { force }))).then(() => {
            setRunning((keys) => keys.filter((k) => k !== key));
            cla.reload();
        });
    };

    // Both halves as one job: CLA first (it creates the page), then RPB into it.
    // The "raid still running?" question is asked once and its answer reused.
    const evaluateBoth = (row: ClaRow) => {
        const keys = (["cla", "rpb"] as LogSection[]).map((s) => `${row.logId}:${s}`);
        setRunning((r) => [...r, ...keys]);
        jobs.run({
            label: "CLA + RPB-Auswertung",
            detail: row.title || row.reportId,
            expectedSeconds: EVAL_SECONDS.cla + EVAL_SECONDS.rpb,
            describe: (r) => ({
                message: "CLA + RPB ausgewertet.",
                link: r.url ? { href: r.url, label: "Report ansehen", external: true } : undefined,
            }),
        }, async () => {
            let force = false;
            await withIncompleteConfirm(ask, (f) => { force = f; return evalLog(row.logId, "cla", { force: f }); });
            return evalLog(row.logId, "rpb", { force });
        }).then(() => {
            setRunning((r) => r.filter((k) => !keys.includes(k)));
            cla.reload();
        });
    };

    const reset = async (row: ClaRow, section: LogSection) => {
        const label = section.toUpperCase();
        if (!(await ask({ title: `${label}-Auswertung verwerfen?`, text: `Die ${label}-Auswertung von „${row.title}“ wird verworfen und kann danach neu gestartet werden.`, action: "Verwerfen" }))) return;
        await quick(() => resetEval(row.logId, section));
    };

    const removeLog = async (row: ClaRow) => {
        if (!(await ask({ title: "Log aus der Liste löschen?", text: `„${row.title}“ wird aus der Liste entfernt. Eine vorhandene Auswertung bleibt als Report erhalten.`, action: "Löschen" }))) return;
        await quick(async () => {
            await deleteLogEntry(row.logId);
            return { message: "Gelöscht." };
        });
    };

    const removeReport = async (row: ClaRow) => {
        if (!row.report) return;
        const reportId = row.report.id;
        if (!(await ask({ title: "Auswertung löschen?", text: `„${row.title}“ wird gelöscht.`, action: "Löschen" }))) return;
        await quick(() => deleteReport(reportId));
    };

    const assign = async (row: ClaRow, eventId: string) => {
        setAssignRow(null);
        await quick(() => linkLog(row.logId, eventId));
    };

    const unlink = async (row: ClaRow) => {
        setAssignRow(null);
        if (!(await ask({ title: "Zuordnung entfernen?", text: `Die Zuordnung von „${row.title}“ zu „${row.eventLabel || row.eventId}“ wird entfernt. Die Auswertung selbst bleibt bestehen.`, action: "Entfernen" }))) return;
        await quick(() => unlinkLog(row.logId));
    };

    const head = (
        <PageHead
            icon="inv_misc_pocketwatch_01"
            tone="cla"
            kicker="Warcraft Logs · CLA & RPB"
            title="Log-Auswertung"
            action={<Button icon="inv_misc_spyglass_02" onClick={() => setNewOpen(true)}>Neue Auswertung</Button>}
        />
    );

    if (cla.error && !data) return <>{head}<div className="empty">Fehler beim Laden: {cla.error.message}</div></>;
    if (!data) return <>{head}<RaidLoader text="Logs werden geladen" /></>;

    const list = data.page;
    const columns: { key?: string; label: string; tip: string; sub: string }[] = [
        { key: "date", label: "Log", tip: "Log", sub: "Titel aus Warcraft Logs, Post-Zeit und Kanal. Sortiert nach der Post-Zeit im Channel." },
        { key: "content", label: "Inhalt", tip: "Inhalt", sub: "Welche Raids das Log enthält und wie viele Bosse liegen. Gelb: der Endboss fehlt, der Raid läuft vielleicht noch." },
        { key: "status", label: "Auswertung", tip: "Auswertung", sub: "CLA (Gear, Consumables, Kampfverlauf) und RPB (Schaden, Tode, Aktivität). Zeit, Spieler und Probleme im Tooltip des Badges." },
        { key: "event", label: "Raid-Event", tip: "Raid-Event", sub: "Das Raid-Helper-Event, zu dem das Log gehört – das Event, dessen Startzeit zur Post-Zeit passt." },
    ];

    return (
        <>
            {head}
            <div className="part-head la-filter">
                <FilterSegment value={data.filter} counts={data.counts} onChange={switchFilter} />
                <div className="ph-act">
                    {data.autoMatchCount > 0 && (
                        <Button
                            variant="ghost" size="sm" icon="spell_holy_borrowedtime" running={automatching} onClick={automatch}
                            data-tip="Automatisch zuordnen" data-tip-sub="Ordnet jedes offene Log dem Raid-Event zu, dessen Startzeit eindeutig passt. Mehrdeutige bleiben für den Zuordnen-Dialog."
                        >
                            Automatisch zuordnen <Badge count tone="mid">{data.autoMatchCount}</Badge>
                        </Button>
                    )}
                    {data.logChannelsConfigured
                        ? (
                            <IconButton
                                icon={scanning ? <span className="btn-spin" aria-hidden="true" /> : "inv_misc_spyglass_03"}
                                tip={scanning ? "Suche läuft …" : "Log-Channels durchsuchen"}
                                tipSub="Sucht in den Log-Channels nach Warcraft-Logs-Links, die der Bot verpasst hat."
                                disabled={scanning} onClick={scan}
                            />
                        )
                        : (
                            <a
                                className={buttonClass("ghost", "sm", true)} href="/settings?section=logs"
                                data-tip="Keine Log-Channels" data-tip-sub="Ohne Log-Channel erkennt der Bot keine Logs von selbst. In den Einstellungen festlegen."
                            ><WowIcon name="inv_letter_15" size={18} />Log-Channels einrichten</a>
                        )}
                </div>
            </div>
            {list.items.length
                ? (
                    <>
                        <div className="la-list" role="table" aria-label="Logs">
                            <div className="la-cols" role="row">
                                <span aria-hidden="true" />
                                {columns.map((c) => (
                                    <span key={c.label} role="columnheader" aria-sort={c.key ? ariaSort(c.key, list.sort, list.dir) : undefined}>
                                        {c.key
                                            ? <SortLabel sortKey={c.key} label={c.label} sort={list.sort} dir={list.dir} onSort={sortBy} tip={c.tip} tipSub={c.sub} />
                                            : c.label}
                                    </span>
                                ))}
                                <span aria-hidden="true" />
                            </div>
                            {list.items.map((row) => (
                                <ListRow
                                    key={row.id}
                                    row={row}
                                    running={ANALYSES.map((a) => a.key).filter((s) => running.includes(`${row.logId}:${s}`))}
                                    eventsError={data.matchEventsError}
                                    onEvaluate={(section) => evaluate(row, section)}
                                    onAssign={() => setAssignRow(row)}
                                    onReset={(section) => reset(row, section)}
                                    onDeleteLog={() => removeLog(row)}
                                    onDeleteReport={() => removeReport(row)}
                                />
                            ))}
                        </div>
                        <Pager page={list} onPage={goToPage} />
                    </>
                )
                : <div className="empty">{FILTER_META[data.filter].empty}</div>}
            <NewEvaluationDialog open={newOpen} onClose={() => setNewOpen(false)} onChanged={cla.reload} />
            <AssignDialog row={assignRow} onClose={() => setAssignRow(null)} onAssign={assign} onUnlink={unlink} />
        </>
    );
}

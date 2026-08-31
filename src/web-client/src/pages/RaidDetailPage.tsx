import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import {
    getRaidDetail, importLoot, clearHistoryEvent, deleteLootItems,
    notifyRaid, pingMissingRaiders, fillRaidsheet, postRaidSheet, postRaidSoftres,
    searchSoftresItems, createSoftres, linkSoftres, evalLog, resetEval, linkLog, linkLogUrl, unlinkLog,
    type ApiError, type RaidDetailData, type SetupPlayer, type AttendancePerson, type LootItem,
    type SoftresCatalogueGroup, type EventSoftres, type RaidLogRow,
    type RaidDetailEventSheet, type LogSection, type SignupStatus,
} from "../api";
import { eventTimeParts, relativeDayLabel, fmtMs } from "../lib/format";
import { usePersistedSearchParam, useDraftState } from "../lib/persistedState";
import ItemSearchPicker from "../components/ItemSearchPicker";
import {
    ClockIcon, RunIcon, TrashIcon, ExternalIcon, SheetIcon, SendIcon, RefreshIcon, LinkIcon,
    SignedIcon, TentativeIcon, LateIcon, BenchIcon, AbsenceIcon,
} from "../components/icons";
import { eventPostUrl, channelUrl, raidplanUrl, messageLink } from "../lib/discordLinks";
import { LootTable } from "../components/LootTable";
import type { ShellContext } from "../components/Shell";
import { useJobs, useToast } from "../components/Jobs";
import PageLoader from "../components/PageLoader";

type Tab = "setup" | "attendance" | "actions" | "loot" | "softres" | "logs";
const TABS: Tab[] = ["setup", "attendance", "actions", "loot", "softres", "logs"];

// Rough runtimes for the job toasts' progress bar — same numbers as ClaPage.
const EVAL_SECONDS: Record<LogSection, number> = { cla: 25, rpb: 55 };

// One KPI cell of the hero header's stat strip: mono label on top, the number
// below in display size, optionally a hairline bar showing it against the
// signup target. Replaces the flat pill row the stats used to be rendered as.
function HeroStat({ label, value, of, tone, fill, title }: {
    label: string;
    value: number | string;
    of?: number;
    tone?: "total" | "warn" | "ok";
    fill?: number;
    title?: string;
}) {
    return (
        <div className={`hero-stat${tone ? ` is-${tone}` : ""}`} title={title}>
            <span className="hero-stat-label">{label}</span>
            <span className="hero-stat-value">
                {value}
                {of ? <span className="hero-stat-of">/ {of}</span> : null}
            </span>
            {typeof fill === "number" && (
                <span className="hero-bar"><i style={{ width: `${Math.min(100, Math.max(0, fill * 100))}%` }} /></span>
            )}
        </div>
    );
}

// Ported from renderAdmin.js's renderEventDetail() overview stat spans (statSpans),
// re-typeset as the hero header's KPI strip.
function OverviewStats({ data }: { data: RaidDetailData }) {
    const { event: ev, setup, attendance, attendanceRoleIds, eventSoftres, signupTarget } = data;
    // A past raid whose roster Raid-Helper no longer serves has an UNKNOWN signup
    // count, not zero — and "everyone is missing" would be nonsense for it.
    const rosterKnown = ev.signupsKnown !== false;
    const signups = ev.signupCount || 0;
    const missing = attendance.missing.length;
    return (
        <div className="hero-stats">
            {rosterKnown
                ? (
                    <HeroStat
                        label="Anmeldungen" value={signups} of={signupTarget || undefined} tone="total"
                        fill={signupTarget ? signups / signupTarget : undefined}
                    />
                )
                : (
                    <HeroStat
                        label="Anmeldungen" value="—" tone="total"
                        title="Raid-Helper liefert für diesen vergangenen Raid keine Anmeldungen mehr"
                    />
                )}
            {!!setup?.total && (
                <HeroStat
                    label="Im Setup" value={setup.total} of={signupTarget || undefined}
                    fill={signupTarget ? setup.total / signupTarget : undefined}
                />
            )}
            {rosterKnown && !!attendanceRoleIds.length && (
                <HeroStat label="Fehlt" value={missing} tone={missing ? "warn" : "ok"} />
            )}
            {!!eventSoftres?.instances?.length && (
                <HeroStat label="Softres" value={eventSoftres.instances.length} title="Softres-Instanzen" />
            )}
        </div>
    );
}

// Raid-roster avatar row: real signups from the current setup (raidplan),
// spec icon per player (class-coloured initials as fallback) with the name in
// small print above, capped with a "+N" overflow chip. Mirrors
// renderAdmin.js's rosterAvatars().
function RosterAvatars({ setup }: { setup: RaidDetailData["setup"] }) {
    if (!setup?.total) return null;
    const players = setup.groups.flatMap((g) => g.players);
    const shown = players.slice(0, 10);
    const rest = players.length - shown.length;
    return (
        <div className="avatar-stack">
            <span className="hero-stat-label hero-roster-label">Roster</span>
            {shown.map((p, i) => {
                const color = p.classColor || "#9aa0aa";
                const sub = p.specName || p.className;
                return (
                    <span key={`${p.name}-${i}`} className="av-item" title={sub ? `${p.name} · ${sub}` : p.name}>
                        <span className="av-name">{p.name}</span>
                        {p.iconUrl
                            ? <img className="av av-ico" src={p.iconUrl} alt={p.specName || p.className || ""} style={{ borderColor: color }} loading="lazy" />
                            : (
                                <span className="av" style={{ background: `${color}2e`, color, borderColor: color }}>
                                    {(p.name || "??").trim().slice(0, 2).toUpperCase()}
                                </span>
                            )}
                    </span>
                );
            })}
            {rest > 0 && <span className="av more">+{rest}</span>}
        </div>
    );
}

// One roster chip — icon (or a blank placeholder) plus the name — shared shape
// between the setup groups and the attendance name lists (renderAdmin.js reuses
// the same "setup-player" markup for both).
function PlayerChip({ iconUrl, className, imgTitle, name }: {
    iconUrl?: string;
    className?: string;
    imgTitle?: string;
    name: string;
}) {
    return (
        <>
            {iconUrl
                ? <img className="setup-ico" src={iconUrl} alt={className || ""} title={imgTitle} loading="lazy" />
                : <span className="setup-ico setup-ico-blank" />}
            <span className="sp-name">{name}</span>
        </>
    );
}

// --- Setup (Raidplan comp) tab: read-only display of the raid groups. ---
function SetupTab({ data }: { data: RaidDetailData }) {
    const { setup, setupError, setupFromSnapshot } = data;
    return (
        <>
            <p className="note">Aktueller Raidplan dieses Events, in Raid-Gruppen 1–5 wie im Raid-Helper. Icons und Farben richten sich nach der WoW-Spec.</p>
            {setupError ? (
                <div className="flash flash-err">Setup konnte nicht geladen werden: {setupError}</div>
            ) : !setup?.total ? (
                <p className="sub">Für dieses Event ist noch kein Setup (Raidplan) angelegt.</p>
            ) : (
                <>
                    <div className="setup-summary">
                        <span className="setup-count setup-total"><b>{setup.total}</b> Raider</span>
                        <span className="setup-count"><b>{setup.groups.length}</b> Gruppen</span>
                    </div>
                    {setupFromSnapshot && (
                        <p className="sub" style={{ marginTop: 10 }}>
                            Stand vom Raidtag (lokal gespeichert) — Raid-Helper liefert den Raidplan dieses Raids nicht mehr.
                        </p>
                    )}
                    <div className="setup-groups">
                        {setup.groups.map((g, gi) => (
                            <div className="setup-group" key={gi}>
                                <h4 className="setup-group-head">{g.label}<span className="setup-group-n">{g.players.length}</span></h4>
                                <div className="setup-group-list">
                                    {g.players.map((p: SetupPlayer, pi) => (
                                        <span key={pi} className="setup-player" style={{ borderLeftColor: p.classColor || "var(--line)" }} title={p.specName}>
                                            <PlayerChip iconUrl={p.iconUrl} className={p.className} imgTitle={p.specName} name={p.name} />
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </>
    );
}

// The reactions, in the order a raid lead cares about them: who is actually
// coming first, the maybes next, the ones who are out last. `signed` is the
// fallback for a signup whose status the backend could not resolve, so an
// unknown Raid-Helper wording lands in "Angemeldet" and never disappears.
const SIGNUP_ORDER: SignupStatus[] = ["signed", "tentative", "late", "bench", "absence"];
const SIGNUP_META: Record<SignupStatus, { label: string; icon: () => JSX.Element }> = {
    signed: { label: "Angemeldet", icon: SignedIcon },
    tentative: { label: "Unsicher", icon: TentativeIcon },
    late: { label: "Kommt später", icon: LateIcon },
    bench: { label: "Bank", icon: BenchIcon },
    absence: { label: "Abgemeldet", icon: AbsenceIcon },
};

/** The status badge of one reaction — colour comes from `.sig-<status>` in the CSS. */
function StatusIcon({ status }: { status: SignupStatus }) {
    const meta = SIGNUP_META[status];
    const Icon = meta.icon;
    return <span className={`sig-ico sig-${status}`} aria-label={meta.label} title={meta.label}><Icon /></span>;
}

/** One person as a rolebox, optionally led by their signup-status icon. */
function PersonBox({ p, status }: { p: AttendancePerson; status?: SignupStatus }) {
    const prof = p.profile;
    const discordName = p.displayName || p.id;
    const label = p.character || discordName;
    const title = [
        status ? SIGNUP_META[status].label : "",
        prof?.specName,
        p.character ? discordName : "",
    ].filter(Boolean).join(" · ");
    const icon = status ? <StatusIcon status={status} /> : null;
    if (!prof) return <span className="rolebox" title={title}>{icon}{label}</span>;
    return (
        <span className="rolebox setup-player" style={{ borderLeftColor: prof.classColor || "var(--line)" }} title={title}>
            {icon}
            <PlayerChip iconUrl={prof.iconUrl} className={prof.className} name={label} />
        </span>
    );
}

/** Alphabetical by the name actually shown, so a list reads like a roster. */
function byLabel(a: AttendancePerson, b: AttendancePerson) {
    const name = (p: AttendancePerson) => (p.character || p.displayName || p.id);
    return name(a).localeCompare(name(b), "de");
}

// A missing/responded name list — a person without a resolved class/spec profile
// renders as a plain rolebox with just the name.
//
// Raid leads think in character names, so a resolved character wins the label
// outright and the Discord display name moves into the tooltip; only someone
// without an assigned character still shows up under their Discord name.
//
// `grouped` splits the list by what the reaction said (Angemeldet / Unsicher /
// Kommt später / Bank / Abgemeldet) — a flat list of 29 names hides the three
// people who signed off. The status is carried by a coloured icon rather than a
// tinted row: the row's colour already belongs to the WoW class.
function NameList({ people, grouped = false }: { people: AttendancePerson[]; grouped?: boolean }) {
    if (!people.length) return <p className="sub">—</p>;
    if (!grouped) {
        return (
            <div className="rolegrid rolegrid-flat">
                {[...people].sort(byLabel).map((p) => <PersonBox key={p.id} p={p} />)}
            </div>
        );
    }
    const groups = SIGNUP_ORDER
        .map((status) => ({
            status,
            people: people.filter((p) => (p.status || "signed") === status).sort(byLabel),
        }))
        .filter((g) => g.people.length);
    return (
        <>
            {groups.map((g) => (
                <div className="sig-group" key={g.status}>
                    <h5 className="sig-group-head">
                        <StatusIcon status={g.status} />
                        {SIGNUP_META[g.status].label}
                        <b>{g.people.length}</b>
                    </h5>
                    <div className="rolegrid rolegrid-flat">
                        {g.people.map((p) => <PersonBox key={p.id} p={p} status={g.status} />)}
                    </div>
                </div>
            ))}
        </>
    );
}

// Pings the raiders who have not reacted yet — mirrors renderAdmin.js's
// pingForm (/admin/raids/ping-missing). A "0 missing" outcome from the backend
// is still a normal success, shown the same as any other flash.
function PingMissingForm({ eventId, missingCount, csrfToken, onDone }: {
    eventId: string;
    missingCount: number;
    csrfToken: string | null;
    onDone: (msg: string) => void;
}) {
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            const r = await pingMissingRaiders(csrfToken, { event: eventId, text });
            onDone(r.message);
            setText("");
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="card-form" style={{ marginTop: 16 }} onSubmit={submit}>
            <div className="field">
                <label>Nachricht (optional)</label>
                <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Bitte meldet euch für den Raid an oder ab." />
                <div className="hint">Wird im Event-Channel gepostet und pingt genau die {missingCount} fehlenden Raider.</div>
            </div>
            <div className="row-actions"><button className="btn" type="submit" disabled={busy}>Fehlende Raider pingen</button></div>
        </form>
    );
}

// --- Anwesenheit tab: role-holder vs. signup reconciliation, plus the
// "Fehlende Raider pingen" form. ---
function AttendanceTab({ data, eventId, csrfToken, onChanged }: {
    data: RaidDetailData;
    eventId: string;
    csrfToken: string | null;
    onChanged: (msg: string) => void;
}) {
    const { attendance, attendanceRoleIds, membersError, event: ev } = data;
    const rosterKnown = ev.signupsKnown !== false;
    return (
        <>
            <p className="note">Abgleich der Raider-Rollen dieser Kategorie mit den Raid-Helper-Anmeldungen: wer sich an- oder abgemeldet hat und wer noch gar nicht reagiert hat.</p>
            {!attendanceRoleIds.length ? (
                <p className="sub">
                    Dieser Kategorie sind noch keine Raider-Rollen zugeordnet. Lege sie in den{" "}
                    <Link className="mlink" to="/settings?section=kategorien">Einstellungen → Kategorien</Link> fest, um zu sehen, wer noch fehlt.
                </p>
            ) : !rosterKnown ? (
                <p className="sub">
                    Für diesen vergangenen Raid liefert Raid-Helper keine Anmeldungen mehr, und es wurde keine
                    gespeichert. Der Abgleich ist daher nicht möglich — ohne diese Daten würden schlicht alle
                    erwarteten Raider als „fehlt“ gelten.
                </p>
            ) : membersError ? (
                <>
                    <div className="flash flash-err">Mitglieder konnten nicht geladen werden: {membersError}</div>
                    <p className="sub">Für den Rollen-Abgleich muss im Discord Developer Portal der <strong>„Server Members Intent“</strong> aktiviert sein.</p>
                </>
            ) : (
                <>
                    <div className="setup-summary">
                        <span className="setup-count setup-total"><b>{attendance.responded.length + attendance.missing.length}</b> erwartet</span>
                        <span className="setup-count"><b>{attendance.responded.length}</b> reagiert</span>
                        <span className="setup-count"><b>{attendance.missing.length}</b> fehlt</span>
                    </div>
                    {ev.signUpsFromSnapshot && (
                        <p className="sub" style={{ marginTop: 10 }}>
                            Stand vom Raidtag (lokal gespeichert) — Raid-Helper liefert die Anmeldungen dieses Raids nicht mehr.
                        </p>
                    )}
                    <h4 style={{ margin: "14px 0 6px" }}>Fehlt (noch keine Reaktion)</h4>
                    <NameList people={attendance.missing} />
                    <h4 style={{ margin: "14px 0 6px" }}>Reagiert (an- oder abgemeldet)</h4>
                    <NameList people={attendance.responded} grouped />
                    {/* Pinging is pointless once the raid has started — the backend refuses it too. */}
                    {ev.isPast
                        ? null
                        : attendance.missing.length
                            ? <PingMissingForm eventId={eventId} missingCount={attendance.missing.length} csrfToken={csrfToken} onDone={onChanged} />
                            : <p className="sub" style={{ marginTop: 12 }}>Es haben schon alle erwarteten Raider reagiert. 🎉</p>}
                </>
            )}
        </>
    );
}

// Header quick-actions, top-right of the meta card: open/post the filled sheet,
// open/post the softres list, or (when none exists yet) jump straight to the
// Softres tab. Mirrors renderAdmin.js's headerBtns — errors from a quick-post
// are shown the same way as a success (both just refresh the page via onDone),
// matching how ClaPage's plain action buttons (scan/automatch) treat errors.
function HeaderActions({ data, eventId, csrfToken, onSwitchTab, onDone }: {
    data: RaidDetailData;
    eventId: string;
    csrfToken: string | null;
    onSwitchTab: (t: Tab) => void;
    onDone: (msg: string) => void;
}) {
    const [busy, setBusy] = useState(false);
    const { sheetLink, eventSoftres, event: ev } = data;
    const channelLabel = ev.channelName || ev.channelId;

    const run = async (fn: () => Promise<{ message: string }>) => {
        setBusy(true);
        try {
            const r = await fn();
            onDone(r.message);
        } catch (err) {
            onDone((err as ApiError).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="hero-actions-row">
            <PageLoader show={busy} text="Wird gepostet" />
            {!!sheetLink && (
                <>
                    <a
                        className="btn btn-ghost" href={sheetLink.url} target="_blank" rel="noopener noreferrer"
                        title={sheetLink.source === "category"
                            ? `Festes Sheet dieser Kategorie${sheetLink.name ? `: ${sheetLink.name}` : ""}`
                            : "Für diesen Raid gefülltes Sheet"}
                    >
                        <SheetIcon />Sheet öffnen
                    </a>
                    <button
                        className="btn btn-ghost" type="button" disabled={busy} title={`Sheet-Link in #${channelLabel} posten`}
                        onClick={() => run(() => postRaidSheet(csrfToken, { event: eventId }))}
                    >
                        <SendIcon />Sheet posten
                    </button>
                </>
            )}
            {eventSoftres?.url ? (
                <>
                    <a className="btn btn-ghost" href={eventSoftres.url} target="_blank" rel="noopener noreferrer">
                        <LinkIcon />Softres öffnen
                    </a>
                    <button
                        className="btn btn-ghost" type="button" disabled={busy} title={`Softres-Link in #${channelLabel} posten`}
                        onClick={() => run(() => postRaidSoftres(csrfToken, { event: eventId }))}
                    >
                        <SendIcon />Softres posten
                    </button>
                </>
            ) : (
                <button className="btn btn-ghost" type="button" onClick={() => onSwitchTab("softres")}>
                    <LinkIcon />Softres erstellen
                </button>
            )}
        </div>
    );
}

// --- Anmeldung & Sheet tab: Anmelde-Aufruf (notify), Raidsheet füllen, Raidsheet posten. ---

function NotifyForm({ data, eventId, csrfToken, onDone }: {
    data: RaidDetailData;
    eventId: string;
    csrfToken: string | null;
    onDone: (msg: string) => void;
}) {
    const { notifyTemplates, roles } = data;
    const [templateId, setTemplateId] = useState(notifyTemplates[0]?.id ?? "");
    const [roleIds, setRoleIds] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    if (!notifyTemplates.length) {
        return (
            <p className="sub">
                Noch keine Aufruf-Vorlagen. Lege zuerst unter <Link className="mlink" to="/raids/templates">Aufruf-Vorlagen</Link> eine an.
            </p>
        );
    }

    const toggleRole = (id: string) => {
        setRoleIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            const r = await notifyRaid(csrfToken, {
                event: eventId, templateId, channelId: data.event.channelId, roleIds: [...roleIds],
            });
            onDone(r.message);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="card-form" onSubmit={submit}>
            <div className="field">
                <label>Aufruf-Vorlage</label>
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} required>
                    {notifyTemplates.map((t) => <option key={t.id} value={t.id}>{t.name || "(ohne Name)"}</option>)}
                </select>
            </div>
            <div className="field">
                <label>Rollen pingen</label>
                {roles.length
                    ? (
                        <div className="rolegrid">
                            {roles.map((r) => (
                                <label key={r.id} className="rolebox">
                                    <input type="checkbox" checked={roleIds.has(r.id)} onChange={() => toggleRole(r.id)} /> @{r.name}
                                </label>
                            ))}
                        </div>
                    )
                    : <p className="sub">Keine Rollen gefunden (Server gewählt?).</p>}
                <div className="hint">Die ausgewählten Rollen werden im Event-Channel angepingt.</div>
            </div>
            <div className="row-actions"><button className="btn" type="submit" disabled={busy}>Anmelde-Aufruf posten</button></div>
        </form>
    );
}

function FillForm({ data, eventId, csrfToken, onDone }: {
    data: RaidDetailData;
    eventId: string;
    csrfToken: string | null;
    onDone: (msg: string) => void;
}) {
    const jobs = useJobs();
    const { raidsheets, matchedSheetId, tankCandidates, eventSheet, sheetLink, event: ev } = data;
    const [sheetId, setSheetId] = useState(matchedSheetId || raidsheets[0]?.id || "");
    const [tank3, setTank3] = useState("");
    const [busy, setBusy] = useState(false);

    if (!raidsheets.length) {
        return <p className="sub">Keine Raidsheets konfiguriert. Lege sie in den <Link className="mlink" to="/settings">Einstellungen</Link> an.</p>;
    }

    // Copying the template in Drive and writing the setup into it takes a while;
    // it runs as a background job so the page stays usable meanwhile.
    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        jobs.run({
            label: "Raidsheet füllen",
            detail: ev.title,
            expectedSeconds: 20,
            describe: (r) => ({ message: r.message }),
        }, () => fillRaidsheet(csrfToken, {
            event: eventId, sheetId, tank3, eventTitle: ev.title, eventStartTime: ev.startTime,
        })).then(() => {
            setBusy(false);
            onDone("");
        });
    };

    const matchHint = matchedSheetId
        ? "Automatisch anhand des Event-Titels vorausgewählt — bei Bedarf ändern."
        : "Kein Raidsheet passte automatisch zum Titel — bitte manuell wählen.";

    return (
        <>
            {!!eventSheet?.url && (
                <div className="sheetcard">
                    <div><strong>Gefülltes Sheet:</strong> <a className="mlink" href={eventSheet.url} target="_blank" rel="noopener noreferrer">{eventSheet.eventTitle || "Sheet öffnen"}</a></div>
                    <div className="hint">
                        {eventSheet.deleteAfter ? `Wird am ${fmtMs(eventSheet.deleteAfter, false)} automatisch gelöscht.` : "Kopie ist angelegt."} Erneutes Füllen ersetzt diese Kopie.
                    </div>
                </div>
            )}
            {/* No own copy, but the category has a fixed sheet — say which link the
                raid is currently using, so "Sheet posten" is never a surprise. */}
            {!eventSheet?.url && sheetLink?.source === "category" && (
                <div className="sheetcard">
                    <div>
                        <strong>Festes Sheet dieser Kategorie:</strong>{" "}
                        <a className="mlink" href={sheetLink.url} target="_blank" rel="noopener noreferrer">{sheetLink.name || "Sheet öffnen"}</a>
                    </div>
                    <div className="hint">
                        Wird verlinkt und gepostet, solange für diesen Raid kein eigenes Sheet erstellt wurde.
                        Zugewiesen in den <Link className="mlink" to="/settings">Einstellungen</Link> unter „Raidsheets".
                    </div>
                </div>
            )}
            <form className="card-form" onSubmit={submit}>
                <div className="field">
                    <label>Vorlage (Ausgangssheet)</label>
                    <select value={sheetId} onChange={(e) => setSheetId(e.target.value)} required>
                        {raidsheets.map((s) => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}
                    </select>
                    <div className="hint">{matchHint}</div>
                </div>
                {tankCandidates.length
                    ? (
                        <div className="field">
                            <label>Tank 3 (Off-Tank, optional)</label>
                            <select value={tank3} onChange={(e) => setTank3(e.target.value)}>
                                <option value="">— keiner —</option>
                                {tankCandidates.map((c) => (
                                    <option key={c.name} value={c.name}>{c.name}{c.specName ? ` — ${c.specName}` : ""}</option>
                                ))}
                            </select>
                            <div className="hint">Auswahl aller tank-fähigen Raider im Setup. Wird in die 3. Tank-Zeile eingetragen.</div>
                        </div>
                    )
                    : (
                        <div className="field">
                            <label>Tank 3 (optional)</label>
                            <input type="text" value={tank3} onChange={(e) => setTank3(e.target.value)} placeholder="Name des 3. Tanks" />
                            <div className="hint">Wird manuell in die Tank-Zeile eingetragen.</div>
                        </div>
                    )}
                <div className="row-actions">
                    <button className={`btn${busy ? " is-running" : ""}`} type="submit" disabled={busy}>
                        {busy ? <span className="btn-spin" /> : <SheetIcon />}
                        {busy ? "Erstelle Sheet …" : "Neues Sheet erstellen & füllen"}
                    </button>
                </div>
            </form>
        </>
    );
}

function PostSheetForm({ eventId, eventSheet, sheetLink, guildId, channelLabel, csrfToken, onDone }: {
    eventId: string;
    eventSheet: RaidDetailEventSheet;
    sheetLink: RaidDetailData["sheetLink"];
    guildId: string;
    channelLabel: string;
    csrfToken: string | null;
    onDone: (msg: string) => void;
}) {
    const [message, setMessage] = useState(eventSheet?.postedMessage || "");
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    // Postable as soon as there is any sheet to link — the raid's own copy, or
    // the fixed one assigned to its category.
    if (!sheetLink) {
        return <p className="sub">Noch kein Sheet vorhanden — fülle oben ein Raidsheet oder weise der Kategorie in den Einstellungen ein festes Sheet zu, dann kannst du den Link hier in den Channel posten.</p>;
    }
    const posted = !!(eventSheet?.postedChannelId && eventSheet?.postedMessageId);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            const r = await postRaidSheet(csrfToken, { event: eventId, message });
            onDone(r.message);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="card-form" onSubmit={submit}>
            <PageLoader show={busy} text="Wird gepostet" />
            <div className="field">
                <label>Nachricht (optional)</label>
                <input type="text" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="z. B. Das Raidsheet für heute Abend – bitte eintragen!" />
                <div className="hint">
                    {posted
                        ? <>Bereits gepostet in #{channelLabel} — <a className="mlink" href={messageLink(guildId, eventSheet!.postedChannelId!, eventSheet!.postedMessageId!)} target="_blank" rel="noopener noreferrer">Nachricht öffnen</a>. Speichern aktualisiert diese Nachricht.</>
                        : <>Postet den Sheet-Link {sheetLink.source === "category" ? "(festes Sheet der Kategorie) " : ""}als Nachricht mit Button in #{channelLabel}.</>}
                </div>
            </div>
            <div className="row-actions">
                <button className="btn" type="submit" disabled={busy}>
                    {posted ? <RefreshIcon /> : <SendIcon />}
                    {posted ? "Nachricht aktualisieren" : "Sheet in Channel posten"}
                </button>
            </div>
        </form>
    );
}

function ActionsTab({ data, eventId, csrfToken, onChanged }: {
    data: RaidDetailData;
    eventId: string;
    csrfToken: string | null;
    onChanged: (msg: string) => void;
}) {
    return (
        <>
            <h2 style={{ marginTop: 0 }}>Anmelde-Aufruf</h2>
            <p className="note">Postet eine Aufruf-Nachricht in den Event-Channel und pingt die gewählten Rollen.</p>
            <NotifyForm data={data} eventId={eventId} csrfToken={csrfToken} onDone={onChanged} />
            <h2>Raidsheet füllen</h2>
            <p className="note">
                Legt für diesen Raid eine eigene Kopie der Vorlage an, überträgt das Raid-Helper-Setup hinein und teilt sie per Link.
                Die Kopie wird 3 Tage nach dem Raid automatisch gelöscht; die Vorlage bleibt unangetastet.
            </p>
            <FillForm data={data} eventId={eventId} csrfToken={csrfToken} onDone={onChanged} />
            <h2>Raidsheet in Channel posten</h2>
            <p className="note">Postet den Link zum gefüllten Raidsheet als Nachricht mit Button in den Event-Channel — optional mit eigener Nachricht.</p>
            <PostSheetForm
                eventId={eventId} eventSheet={data.eventSheet} sheetLink={data.sheetLink} guildId={data.guildId}
                channelLabel={data.event.channelName || data.event.channelId} csrfToken={csrfToken} onDone={onChanged}
            />
        </>
    );
}

// --- Softres tab: existing-list display, manual-link form, create form with a
// live Wowhead hard-reserve item search. ---

// The shared Wowhead item picker, searching the softres endpoint for the raid
// edition this event is in (see components/ItemSearchPicker).
function HardReservePicker({ edition, onAdd }: {
    edition: string;
    onAdd: (item: { id: number; name: string }) => void;
}) {
    const search = useCallback((q: string) => searchSoftresItems(edition, q), [edition]);
    return <ItemSearchPicker search={search} onPick={(it) => onAdd({ id: it.id, name: it.name })} />;
}

function SoftresLinkForm({ eventSoftres, eventId, csrfToken, onDone }: {
    eventSoftres: EventSoftres;
    eventId: string;
    csrfToken: string | null;
    onDone: (msg: string) => void;
}) {
    const [softresUrl, setSoftresUrl] = useState(eventSoftres?.url || "");
    const [softresEditUrl, setSoftresEditUrl] = useState(eventSoftres?.editUrl || "");
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            const r = await linkSoftres(csrfToken, { event: eventId, softresUrl, softresEditUrl });
            onDone(r.message);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <details>
            <summary style={{ cursor: "pointer" }}>
                {eventSoftres?.url ? "Anderen Softres-Link verwenden" : "Schon eine Liste auf softres.it? Link manuell hinterlegen"}
            </summary>
            <form className="card-form" style={{ marginTop: 10 }} onSubmit={submit}>
                <div className="field">
                    <label>Softres-Link (Ansehen)</label>
                    <input type="url" value={softresUrl} onChange={(e) => setSoftresUrl(e.target.value)} placeholder="https://softres.it/raid/..." required />
                </div>
                <div className="field">
                    <label>Softres-Link (Bearbeiten, optional)</label>
                    <input type="url" value={softresEditUrl} onChange={(e) => setSoftresEditUrl(e.target.value)} placeholder="https://softres.it/raid/...?adminToken=..." />
                </div>
                <div className="row-actions"><button className="btn" type="submit" disabled={busy}>Link speichern</button></div>
            </form>
        </details>
    );
}

// Instance codes grouped by edition, so the single-edition constraint can be
// checked without a DOM query (unlike the legacy inline vanilla-JS script):
// checking a box from a different edition than what's already checked drops
// every other edition's selections.
function editionMap(catalogue: SoftresCatalogueGroup[]): Map<string, string> {
    const m = new Map<string, string>();
    for (const g of catalogue) for (const i of g.instances) m.set(i.code, g.edition);
    return m;
}

// What the create form holds. Instance codes are an array, not a Set, because
// the draft has to round-trip through JSON — the Set is rebuilt on read.
type SoftresDraft = {
    codes: string[];
    amount: number;
    faction: "Horde" | "Alliance";
    hardReserves: Array<{ id: number; name: string }>;
    protection: boolean;
};

function SoftresCreateForm({ data, eventId, csrfToken, onDone }: {
    data: RaidDetailData;
    eventId: string;
    csrfToken: string | null;
    onDone: (msg: string) => void;
}) {
    const { softresCatalogue, softresSuggested, softresEdition } = data;
    // Draft per event: picking instances and searching hard-reserve items is real
    // work, and the softres tab is one click away from the loot/logs tabs.
    // User Protection (Login-Pflicht zum Reservieren) ist der Standard für neue Listen.
    const [draft, patch, clearDraft] = useDraftState<SoftresDraft>(`raid-softres:${eventId}`, {
        codes: softresSuggested || [], amount: 1, faction: "Horde", hardReserves: [], protection: true,
    });
    const { amount, faction, hardReserves, protection } = draft;
    const selected = useMemo(() => new Set(draft.codes), [draft.codes]);
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    const codeEdition = useMemo(() => editionMap(softresCatalogue), [softresCatalogue]);
    const currentEdition = useMemo(() => {
        for (const code of selected) {
            const ed = codeEdition.get(code);
            if (ed) return ed;
        }
        return softresEdition || softresCatalogue[0]?.edition || "tbc";
    }, [selected, codeEdition, softresEdition, softresCatalogue]);

    const toggle = (code: string, edition: string) => {
        const next = new Set(selected);
        if (next.has(code)) {
            next.delete(code);
        } else {
            for (const c of next) if (codeEdition.get(c) !== edition) next.delete(c);
            next.add(code);
        }
        patch({ codes: [...next] });
    };

    const addHardReserve = (item: { id: number; name: string }) => {
        if (hardReserves.some((x) => x.id === item.id)) return;
        patch({ hardReserves: [...hardReserves, item] });
    };
    const removeHardReserve = (id: number) => patch({ hardReserves: hardReserves.filter((x) => x.id !== id) });

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            const r = await createSoftres(csrfToken, {
                event: eventId, instanceCodes: [...selected], amount, faction, hardReserves, hideReserves: false, protection,
            });
            // The list exists now — keeping the draft would only offer to build a
            // second one from the same picks.
            clearDraft();
            onDone(r.message);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="card-form" onSubmit={submit}>
            <div className="field">
                <label>Instanzen (Raids)</label>
                {softresCatalogue.map((g) => (
                    <fieldset key={g.edition} className="softres-ed">
                        <legend>{g.label}</legend>
                        <div className="rolegrid">
                            {g.instances.map((i) => (
                                <label key={i.code} className="rolebox">
                                    <input type="checkbox" checked={selected.has(i.code)} onChange={() => toggle(i.code, g.edition)} /> {i.name}
                                </label>
                            ))}
                        </div>
                    </fieldset>
                ))}
                <div className="hint">
                    Aus dem Event-Titel vorausgewählt. Alle gewählten Instanzen müssen zur selben Erweiterung gehören —
                    beim Ankreuzen wird die Auswahl automatisch auf eine Erweiterung beschränkt.
                </div>
            </div>
            <div className="field" style={{ maxWidth: 220 }}>
                <label>Softres pro Spieler</label>
                <input
                    type="number" min={1} max={6} value={amount}
                    onChange={(e) => patch({ amount: Math.max(1, Math.min(6, Number(e.target.value) || 1)) })}
                />
            </div>
            <div className="field" style={{ maxWidth: 220 }}>
                <label>Fraktion</label>
                <select value={faction} onChange={(e) => patch({ faction: e.target.value as "Horde" | "Alliance" })}>
                    <option value="Horde">Horde</option>
                    <option value="Alliance">Alliance</option>
                </select>
            </div>
            <div className="field">
                <label>User Protection</label>
                <label className="rolebox">
                    <input type="checkbox" checked={protection} onChange={(e) => patch({ protection: e.target.checked })} /> Login zum Reservieren verlangen
                </label>
                <div className="hint">
                    Standard: an. Spieler müssen sich auf softres.it einloggen (Discord oder Battle.net) und können
                    dann nur ihre eigenen Reserves ändern. Aus: jeder kann die Reserves aller anderen bearbeiten.
                </div>
            </div>
            <div className="field">
                <label>Hardreserved Items (optional)</label>
                <HardReservePicker edition={currentEdition} onAdd={addHardReserve} />
                {hardReserves.length > 0 && (
                    <ul className="hr-list">
                        {hardReserves.map((hr) => (
                            <li key={hr.id} className="rolebox hr-chip">
                                <span>{hr.name} (#{hr.id})</span>
                                <button type="button" className="btn btn-sm" onClick={() => removeHardReserve(hr.id)}>✕</button>
                            </li>
                        ))}
                    </ul>
                )}
                <div className="hint">Diese Items werden auf softres.it als Hardreserve (gebannt für Softres) markiert.</div>
            </div>
            <div className="row-actions">
                <button className="btn" type="submit" disabled={busy}>{busy ? "Erstelle Softres …" : "Softres-Liste erstellen"}</button>
            </div>
        </form>
    );
}

function PostSoftresForm({ eventId, eventSoftres, guildId, channelLabel, csrfToken, onDone }: {
    eventId: string;
    eventSoftres: EventSoftres;
    guildId: string;
    channelLabel: string;
    csrfToken: string | null;
    onDone: (msg: string) => void;
}) {
    const [message, setMessage] = useState(eventSoftres?.postedMessage || "");
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    if (!eventSoftres?.url) return null;
    const posted = !!(eventSoftres.postedChannelId && eventSoftres.postedMessageId);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            const r = await postRaidSoftres(csrfToken, { event: eventId, message });
            onDone(r.message);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="card-form" style={{ marginTop: 12 }} onSubmit={submit}>
            <PageLoader show={busy} text="Wird gepostet" />
            <div className="field">
                <label>Nachricht (optional)</label>
                <input type="text" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="z. B. Bitte bis Raidbeginn eintragen!" />
                <div className="hint">
                    {posted
                        ? <>Bereits gepostet in #{channelLabel} — <a className="mlink" href={messageLink(guildId, eventSoftres.postedChannelId!, eventSoftres.postedMessageId!)} target="_blank" rel="noopener noreferrer">Nachricht öffnen</a>. Speichern aktualisiert diese Nachricht.</>
                        : <>Postet den Softres-Link als Nachricht mit Button in #{channelLabel}.</>}
                </div>
            </div>
            <div className="row-actions">
                <button className="btn" type="submit" disabled={busy}>
                    {posted ? <RefreshIcon /> : <SendIcon />}
                    {posted ? "Nachricht aktualisieren" : "Softres in Channel posten"}
                </button>
            </div>
        </form>
    );
}

function SoftresTab({ data, eventId, csrfToken, onChanged }: {
    data: RaidDetailData;
    eventId: string;
    csrfToken: string | null;
    onChanged: (msg: string) => void;
}) {
    const so = data.eventSoftres;
    return (
        <>
            <h2 style={{ marginTop: 0 }}>Softres-Liste erstellen</h2>
            <p className="note">
                Legt eine Soft-Reserve-Liste auf softres.it an — die Instanzen sind aus dem Event-Titel vorausgewählt.
                Wähle die Anzahl der Softres pro Spieler und markiere optional hardreservten Loot. Du bekommst danach einen
                Ansehen- und einen Bearbeiten-Link.
            </p>
            {so?.url
                ? (
                    <div className="sheetcard">
                        <div>
                            <strong>Softres-Liste:</strong>{" "}
                            <a className="mlink" href={so.url} target="_blank" rel="noopener noreferrer">Ansehen</a>
                            {" · "}
                            <a className="mlink" href={so.editUrl} target="_blank" rel="noopener noreferrer">Bearbeiten (mit Token)</a>
                        </div>
                        <div className="hint">
                            {so.amount || 1} Softres/Spieler · {(so.instances || []).length} Instanz(en)
                            {so.hardReserveCount ? ` · ${so.hardReserveCount} Hardreserve(s)` : ""}. Neu erstellen ersetzt den Link unten nicht automatisch auf softres.it.
                        </div>
                        <SoftresLinkForm eventSoftres={so} eventId={eventId} csrfToken={csrfToken} onDone={onChanged} />
                        <PostSoftresForm
                            eventId={eventId} eventSoftres={so} guildId={data.guildId}
                            channelLabel={data.event.channelName || data.event.channelId} csrfToken={csrfToken} onDone={onChanged}
                        />
                    </div>
                )
                : <SoftresLinkForm eventSoftres={so} eventId={eventId} csrfToken={csrfToken} onDone={onChanged} />}
            <SoftresCreateForm data={data} eventId={eventId} csrfToken={csrfToken} onDone={onChanged} />
        </>
    );
}

// Simpler than HistoryPage's ImportForm — no event selector, the event is fixed
// by the page we're already on.
function LootImportForm({ eventId, defaultTool, csrfToken, onImported }: {
    eventId: string;
    defaultTool: string;
    csrfToken: string | null;
    onImported: (msg: string) => void;
}) {
    // Draft per event: a pasted export belongs to exactly this raid, so it must
    // never reappear in another raid's import form.
    const [draft, patch] = useDraftState(`raid-loot-import:${eventId}`, { tool: defaultTool || "auto", text: "" });
    const { tool, text } = draft;
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const fileRef = useRef<HTMLInputElement>(null);

    const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => patch({ text: String(reader.result || "") });
        reader.readAsText(file);
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            const r = await importLoot(csrfToken, { data: text, tool, event: eventId, manualLabel: "" });
            onImported(`${r.added} Item(s) importiert${r.skipped ? `, ${r.skipped} Duplikat(e) übersprungen` : ""}.`);
            patch({ text: "" });
            if (fileRef.current) fileRef.current.value = "";
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="dash-card">
            <div className="dash-card-head"><h3>Loot importieren</h3></div>
            <form className="card-form" onSubmit={submit} style={{ padding: "14px 16px" }}>
                <div className="field">
                    <label>Loot-Tool</label>
                    <select value={tool} onChange={(e) => patch({ tool: e.target.value })}>
                        <option value="auto">Auto-Erkennung</option>
                        <option value="gargul">Gargul</option>
                        <option value="rclc">RCLootcouncil</option>
                    </select>
                    <div className="hint">„Auto" erkennt JSON (RCLootcouncil) bzw. CSV (Gargul) selbst.</div>
                </div>
                <div className="field">
                    <label>Export einfügen</label>
                    <textarea value={text} onChange={(e) => patch({ text: e.target.value })} rows={6} placeholder="RCLootcouncil-JSON oder Gargul-CSV hier einfügen …" />
                </div>
                <div className="field">
                    <label>… oder Datei hochladen</label>
                    <input ref={fileRef} type="file" accept=".json,.csv,.txt,.tsv" onChange={onFile} />
                    <div className="hint">Die Datei wird lokal in das Feld oben geladen — kein separater Upload.</div>
                </div>
                <div className="row-actions"><button className="btn" type="submit" disabled={busy}>{busy ? "Importiert…" : "Loot importieren"}</button></div>
            </form>
        </div>
    );
}

// --- Loot tab: reuses the already-migrated importLoot/clearHistoryEvent endpoints. ---
function LootTab({ data, eventId, csrfToken, onChanged }: {
    data: RaidDetailData;
    eventId: string;
    csrfToken: string | null;
    onChanged: (msg: string) => void;
}) {
    const [busy, setBusy] = useState(false);

    const clear = async () => {
        if (!confirm("Gesamten Loot dieses Events löschen?")) return;
        setBusy(true);
        try {
            const r = await clearHistoryEvent(csrfToken, eventId);
            onChanged(`${r.removed} Loot-Eintrag/-Einträge gelöscht.`);
        } catch (err) {
            onChanged((err as ApiError).message);
        } finally {
            setBusy(false);
        }
    };

    // One wrong row instead of the whole import — onChanged reloads the raid
    // detail, so the table comes back without it.
    const removeItem = async (it: LootItem) => {
        try {
            await deleteLootItems(csrfToken, [it.id]);
            onChanged(`„${it.itemName || `Item ${it.itemId}`}" gelöscht.`);
        } catch (err) {
            onChanged((err as ApiError).message);
        }
    };

    return (
        <>
            <p className="note">
                RCLootcouncil-Export (JSON) oder Gargul-CSV dieses Raids einfügen oder hochladen — landet direkt in der{" "}
                <Link className="mlink" to="/history">Event-Historie</Link>. Bereits importierter Loot wird beim erneuten Import
                automatisch übersprungen (Duplikat-Erkennung).
            </p>
            {data.lootItems.length > 0 && (
                <div className="dash-card" style={{ marginBottom: 18 }}>
                    <div className="dash-card-head">
                        <h3>Bereits importierter Loot</h3>
                        <span className="small" style={{ marginLeft: "auto" }}>{data.lootItems.length} Item(s)</span>
                    </div>
                    <div className="row-actions" style={{ padding: "0 16px 12px", justifyContent: "flex-end" }}>
                        <button className="btn btn-danger btn-sm" type="button" disabled={busy} onClick={clear}><TrashIcon />Loot löschen</button>
                    </div>
                    <LootTable items={data.lootItems} onDelete={removeItem} />
                </div>
            )}
            <LootImportForm eventId={eventId} defaultTool={data.lootTool || "auto"} csrfToken={csrfToken} onImported={onChanged} />
        </>
    );
}

// --- Logs tab: Warcraft-Logs already assigned to this raid (evaluate/unlink),
// plus a picker to assign a still-unassigned detected log to this raid. Reuses
// the same /api/cla/eval, /api/cla/log-link, /api/cla/log-unlink endpoints as
// the CLA page's "Erkannte Logs" tab, just scoped to a single event here. ---
// The two analyses a log can be run through, each on its own button. Both write
// into the same report page, so a log can be completed in two steps.
const LOG_ANALYSES: { key: LogSection; label: string; title: string }[] = [
    { key: "cla", label: "CLA", title: "Gear, Verzauberungen, Sockel, Consumables, Drums, Potions & Shadow-Resi" },
    { key: "rpb", label: "RPB", title: "Vermeidbarer Schaden, Tode, Aktivität, Cooldowns, Interrupts & Log-Prüfung" },
];

function LogRow({ l, runningSections, unlinkBusy, onEvaluate, onReset, onUnlink }: {
    l: RaidLogRow;
    /** Analyses of this log started from this page and not finished yet. */
    runningSections: LogSection[];
    unlinkBusy: boolean;
    onEvaluate: (section: LogSection) => void;
    onReset: (section: LogSection) => void;
    onUnlink: () => void;
}) {
    const wclUrl = l.link || (l.reportId ? `https://classic.warcraftlogs.com/reports/${l.reportId}` : "");
    const name = l.title || l.reportId || "(unbekannt)";
    const done = l.sections || [];
    const reportHref = l.reportUrl || (l.reportRefId ? `/r/${l.reportRefId}` : "");

    return (
        <div className="row-actions" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--line-soft)" }}>
            <div>
                {wclUrl
                    ? <a className="mlink" href={wclUrl} target="_blank" rel="noopener noreferrer">{name} ↗</a>
                    : name}
                {" "}
                {done.length
                    ? LOG_ANALYSES.filter((a) => done.includes(a.key)).map((a) => (
                        // the ✕ discards just this half, so an incomplete run can be repeated
                        <span key={a.key} className="pill good" style={{ marginRight: 4 }}>
                            {a.label}
                            <button
                                type="button"
                                className="pill-x"
                                title={`${a.label}-Auswertung verwerfen (kann danach neu gestartet werden)`}
                                aria-label={`${a.label}-Auswertung verwerfen`}
                                onClick={() => onReset(a.key)}
                            >×</button>
                        </span>
                    ))
                    : <span className="pill">offen</span>}
            </div>
            <div className="row-actions" style={{ gap: 6 }}>
                {LOG_ANALYSES.filter((a) => !done.includes(a.key)).map((a) => {
                    const running = runningSections.includes(a.key);
                    return (
                        <button
                            key={a.key}
                            className={`btn btn-run btn-sm${running ? " is-running" : ""}`}
                            type="button"
                            title={running ? `${a.label}-Auswertung läuft im Hintergrund` : a.title}
                            disabled={running}
                            onClick={() => onEvaluate(a.key)}
                        >
                            {running ? <span className="btn-spin" /> : <RunIcon />}
                            {a.label} auswerten
                        </button>
                    );
                })}
                {reportHref ? <a className="btn btn-ghost btn-sm" href={reportHref}><ExternalIcon />Öffnen</a> : null}
                <button className="btn btn-ghost btn-sm" type="button" disabled={unlinkBusy} title="Zuordnung entfernen" onClick={onUnlink}>✕</button>
            </div>
        </div>
    );
}

function LogsTab({ data, eventId, csrfToken, onChanged }: {
    data: RaidDetailData;
    eventId: string;
    csrfToken: string | null;
    onChanged: (msg: string) => void;
}) {
    const jobs = useJobs();
    // "<logId>:<section>" per analysis started here and still going — cosmetic and
    // page-local; the job itself lives in JobsProvider and outlives this page.
    const [running, setRunning] = useState<string[]>([]);
    const [unlinkBusyId, setUnlinkBusyId] = useState<string | null>(null);
    const [pickedLogId, setPickedLogId] = useState("");
    const [linkBusy, setLinkBusy] = useState(false);

    const evaluate = (l: RaidLogRow, section: LogSection) => {
        const label = section.toUpperCase();
        const key = `${l.id}:${section}`;
        setRunning((keys) => [...keys, key]);
        jobs.run({
            label: `${label}-Auswertung`,
            detail: l.title || l.reportId || "",
            expectedSeconds: EVAL_SECONDS[section],
            describe: (r) => ({
                message: r.alreadyEvaluated ? `${label}-Auswertung lag bereits vor.` : `${label}-Auswertung erstellt.`,
                link: r.url ? { href: r.url, label: "Report ansehen ↗", external: true } : undefined,
            }),
        }, () => evalLog(csrfToken, l.id, section)).then(() => {
            setRunning((keys) => keys.filter((k) => k !== key));
            onChanged("");
        });
    };

    const reset = async (l: RaidLogRow, section: LogSection) => {
        const label = section.toUpperCase();
        if (!confirm(`${label}-Auswertung dieses Logs verwerfen? Sie kann danach neu gestartet werden.`)) return;
        try {
            const r = await resetEval(csrfToken, l.id, section);
            onChanged(r.message);
        } catch (err) {
            onChanged((err as ApiError).message);
        }
    };

    const unlink = async (l: RaidLogRow) => {
        if (!confirm("Zuordnung zu diesem Raid entfernen?")) return;
        setUnlinkBusyId(l.id);
        try {
            const r = await unlinkLog(csrfToken, l.id);
            onChanged(r.message);
        } catch (err) {
            onChanged((err as ApiError).message);
        } finally {
            setUnlinkBusyId(null);
        }
    };

    const unlinked = data.unlinkedLogs;
    const assign = async (e: React.FormEvent) => {
        e.preventDefault();
        const logId = pickedLogId || unlinked[0]?.id;
        if (!logId) return;
        setLinkBusy(true);
        try {
            const r = await linkLog(csrfToken, logId, eventId);
            onChanged(r.message);
            setPickedLogId("");
        } catch (err) {
            onChanged((err as ApiError).message);
        } finally {
            setLinkBusy(false);
        }
    };

    // Kept as a draft per event: a link pasted from Warcraft Logs shouldn't be
    // gone after a look at the loot tab.
    const [urlDraft, patchUrlDraft] = useDraftState(`raid-log-url:${eventId}`, { wclUrl: "" });
    const wclUrl = urlDraft.wclUrl;
    const [urlBusy, setUrlBusy] = useState(false);
    const assignUrl = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!wclUrl.trim()) return;
        setUrlBusy(true);
        try {
            const r = await linkLogUrl(csrfToken, wclUrl.trim(), eventId);
            onChanged(r.message);
            patchUrlDraft({ wclUrl: "" });
        } catch (err) {
            onChanged((err as ApiError).message);
        } finally {
            setUrlBusy(false);
        }
    };

    return (
        <>
            <h2 style={{ marginTop: 0 }}>Zugeordnete Logs</h2>
            {data.eventLogs.length
                ? data.eventLogs.map((l) => (
                    <LogRow
                        key={l.id}
                        l={l}
                        runningSections={LOG_ANALYSES.map((a) => a.key).filter((s) => running.includes(`${l.id}:${s}`))}
                        unlinkBusy={unlinkBusyId === l.id}
                        onEvaluate={(section) => evaluate(l, section)}
                        onReset={(section) => reset(l, section)}
                        onUnlink={() => unlink(l)}
                    />
                ))
                : <p className="sub">Für dieses Event ist noch kein Log zugeordnet.</p>}
            <h2>Log zuordnen</h2>
            <p className="note">Ordnet ein bereits erkanntes, aber noch keinem Event zugeordnetes Log diesem Raid zu — oder füge direkt einen Warcraft-Logs-Link ein, der noch nirgends gepostet wurde.</p>
            {unlinked.length
                ? (
                    <form className="row-actions" style={{ gap: 8, flexWrap: "wrap" }} onSubmit={assign}>
                        <select className="sel-sm" value={pickedLogId || unlinked[0].id} onChange={(e) => setPickedLogId(e.target.value)}>
                            {unlinked.map((l) => <option key={l.id} value={l.id}>{l.title || l.reportId || "(unbekannt)"}</option>)}
                        </select>
                        <button className="btn btn-ghost btn-sm" type="submit" disabled={linkBusy}>Log zuordnen</button>
                    </form>
                )
                : <p className="sub">Keine noch nicht zugeordneten Logs vorhanden.</p>}
            <form className="row-actions" style={{ gap: 8, flexWrap: "wrap", marginTop: 12 }} onSubmit={assignUrl}>
                <input
                    type="text" value={wclUrl} onChange={(e) => patchUrlDraft({ wclUrl: e.target.value })} required
                    className="inp-sm" style={{ minWidth: 320, flex: 1, maxWidth: 520 }}
                    placeholder="https://classic.warcraftlogs.com/reports/abc123…" aria-label="Warcraft-Logs-Link"
                />
                <button className="btn btn-ghost btn-sm" type="submit" disabled={urlBusy}>WCL-Link zuordnen</button>
            </form>
        </>
    );
}

export default function RaidDetailPage() {
    const { csrfToken } = useOutletContext<ShellContext>();
    const [searchParams] = useSearchParams();
    const eventId = searchParams.get("event") || "";
    // Remembered across raids: opening the next event lands on the tab that was
    // worked in last (the ?event= param is kept by the hook).
    const [tab, switchTab] = usePersistedSearchParam<Tab>("raid-detail-tab", "tab", "setup", TABS);

    const jobs = useJobs();
    const [data, setData] = useState<RaidDetailData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);

    const load = () => {
        getRaidDetail(eventId).then(setData).catch((err: ApiError) => setError(err));
    };

    useEffect(load, [eventId]);

    // Shared success handler for every mutating action on this page (header
    // quick-posts, all Part B forms, and the loot tab): toast the message, then
    // reload so the header/stats/tabs reflect the new state. An empty message
    // means the action already reported itself through its own job toast — then
    // this only refreshes.
    const afterChange = (msg: string) => {
        if (msg) jobs.notify(msg);
        load();
    };

    const backLink = <p className="note"><Link className="mlink" to="/raids">← Zurück zur Event-Übersicht</Link></p>;

    if (error) return <>{backLink}<div className="empty">Fehler beim Laden: {error.message}</div></>;
    if (!data) return <div className="empty">Lade…</div>;

    const ev = data.event;
    const when = eventTimeParts(ev.startTime);
    const relDay = relativeDayLabel(ev.startTime);
    const isPast = !!ev.startTime && ev.startTime * 1000 < Date.now();
    const isSoon = relDay === "heute" || relDay === "morgen";

    return (
        <>
            {backLink}
            {data.eventsWarning && <div className="flash flash-err">{data.eventsWarning}</div>}

            <header className="page-hero">
                <div className="hero-main">
                    <div className="hero-date" title={when?.full || undefined}>
                        <span className="hero-date-dow">{when?.weekday || "—"}</span>
                        <span className="hero-date-day">{when?.day || "··"}</span>
                        <span className="hero-date-mon">{when ? `${when.month} ${when.year}` : ""}</span>
                    </div>
                    <div className="hero-ident">
                        <div className="hero-eyebrow">
                            <span className="hero-kicker">Raid-Event</span>
                            {data.categoryName && <span className="cat-badge">{data.categoryName}</span>}
                        </div>
                        <h1 className="hero-title">{ev.title || "(ohne Titel)"}</h1>
                        <div className="hero-when">
                            <ClockIcon />
                            <span className="hero-time">{when?.time || "—"}</span>
                            <span className="hero-time-unit">Uhr</span>
                            {relDay && <span className={`hero-rel${isPast ? " is-past" : isSoon ? " is-soon" : ""}`}>{relDay}</span>}
                        </div>
                    </div>
                    <div className="hero-actions">
                        <HeaderActions data={data} eventId={eventId} csrfToken={csrfToken} onSwitchTab={switchTab} onDone={afterChange} />
                    </div>
                </div>

                <dl className="hero-meta">
                    <div className="hero-meta-item">
                        <dt>Channel</dt>
                        <dd>
                            <a className="mlink" href={channelUrl(data.guildId, ev.channelId)} target="_blank" rel="noopener noreferrer">
                                #{ev.channelName || ev.channelId}
                            </a>
                        </dd>
                    </div>
                    <div className="hero-meta-item">
                        <dt>Discord</dt>
                        <dd>
                            <a className="mlink" href={eventPostUrl(data.guildId, ev.channelId, ev.id)} target="_blank" rel="noopener noreferrer">
                                Event-Post öffnen
                            </a>
                        </dd>
                    </div>
                    <div className="hero-meta-item">
                        <dt>Raid-Helper</dt>
                        <dd>
                            <a className="mlink" href={raidplanUrl(ev.id)} target="_blank" rel="noopener noreferrer">Setup / Comp</a>
                        </dd>
                    </div>
                </dl>

                <div className="hero-foot">
                    <OverviewStats data={data} />
                    <RosterAvatars setup={data.setup} />
                </div>
            </header>

            <div className="tabs" role="tablist">
                <button type="button" className={`tab-btn${tab === "setup" ? " active" : ""}`} role="tab" onClick={() => switchTab("setup")}>Setup</button>
                <button type="button" className={`tab-btn${tab === "attendance" ? " active" : ""}`} role="tab" onClick={() => switchTab("attendance")}>Anwesenheit</button>
                <button type="button" className={`tab-btn${tab === "actions" ? " active" : ""}`} role="tab" onClick={() => switchTab("actions")}>Anmeldung &amp; Sheet</button>
                <button type="button" className={`tab-btn${tab === "loot" ? " active" : ""}`} role="tab" onClick={() => switchTab("loot")}>
                    Loot
                    {!!data.lootItems.length && <span className="tab-count">{data.lootItems.length}</span>}
                </button>
                <button type="button" className={`tab-btn${tab === "softres" ? " active" : ""}`} role="tab" onClick={() => switchTab("softres")}>Softres</button>
                <button type="button" className={`tab-btn${tab === "logs" ? " active" : ""}`} role="tab" onClick={() => switchTab("logs")}>
                    Logs
                    {!!data.eventLogs.length && <span className="tab-count">{data.eventLogs.length}</span>}
                </button>
            </div>

            {tab === "setup" && <SetupTab data={data} />}
            {tab === "attendance" && <AttendanceTab data={data} eventId={eventId} csrfToken={csrfToken} onChanged={afterChange} />}
            {tab === "actions" && <ActionsTab data={data} eventId={eventId} csrfToken={csrfToken} onChanged={afterChange} />}
            {tab === "loot" && <LootTab data={data} eventId={eventId} csrfToken={csrfToken} onChanged={afterChange} />}
            {tab === "softres" && <SoftresTab data={data} eventId={eventId} csrfToken={csrfToken} onChanged={afterChange} />}
            {tab === "logs" && <LogsTab data={data} eventId={eventId} csrfToken={csrfToken} onChanged={afterChange} />}
        </>
    );
}

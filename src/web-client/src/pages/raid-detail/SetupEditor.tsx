// Tab "Setup" of an own event (#263): the proposal, the orga's changes, the
// approval. Kept calm on purpose — group cards with one compact line per
// raider, the bench beside them and a narrow column with only what decides
// the evening (roles against the plan, buffs, fairness, wishes). Why somebody
// stands where they do is the line's tooltip, the weights sit behind a dialog,
// and so does Claude's explanation.
//
// Moving: drag a raider onto a group, onto the bench or onto another raider
// (swap). Without a mouse: activate a raider (click, Enter), then the target.
// Every move is saved at once and comes back valued by the server.
import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import {
    approveRaidSetup, explainRaidSetup, getRaidSetup, getRaidSetupExplain, proposeRaidSetup, publishRaidSetup, saveRaidSetup,
    type ApiError, type SetupEditorData, type SetupEditorGroup, type SetupPerson, type SetupPlacementInput, type StoredSetup,
} from "../../api";
import {
    applyLocal, dpsCheck, moveRaider, peopleOf, publishHint, roleTarget, toInput, toggleLock, withAllGroups, GROUP_SIZE,
    type SetupTarget,
} from "../../lib/setupEditor";
import { wowIconUrl } from "../../lib/wowIcon";
import { Button, IconButton } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import { Modal, useConfirm } from "../../components/ui/Modal";
import RaidLoader from "../../components/ui/RaidLoader";
import WowIcon from "../../components/ui/WowIcon";
import { useJobs } from "../../components/Jobs";
import { LockIcon, UnlockIcon } from "../../components/icons";
import { classColorProps } from "../../components/ClassSpec";
import SpecTile from "./SpecTile";
import type { RaidCtx } from "./meta";
import "../../styles/setup-editor.css";

const ROLE_LABEL: Record<string, string> = { tank: "Tank", healer: "Heiler", melee: "Nahkampf", ranged: "Fernkampf" };
const STATUS_LABEL: Record<string, string> = { late: "Kommt später", tentative: "Vielleicht", bench: "Als Ersatz angemeldet" };
const WEIGHT_LABELS: { key: string; label: string; tip: string }[] = [
    { key: "requiredBuffs", label: "Pflicht-Buffs", tip: "Buffs, die die Raid-Vorlage verlangt." },
    { key: "mainSpec", label: "Hauptspec", tip: "Raider auf der Spec, mit der sie sich angemeldet haben." },
    { key: "preferredCharacter", label: "Wunsch-Charakter", tip: "Wer mehrere Charaktere angibt, kommt mit dem ersten mit – ein „kann auch mit“-Charakter kostet so viel." },
    { key: "fairness", label: "Fairness", tip: "Wer zuletzt oder oft auf der Bank saß, kommt eher mit. Nur wenn Fairness an ist." },
    { key: "status", label: "Anmeldestatus", tip: "„Dabei“ vor „Kommt später“ vor „Vielleicht“." },
    { key: "partyBuffs", label: "Gruppen-Buffs", tip: "Totems, Auren, Schreie in der Gruppe, die sie brauchen." },
    { key: "wishes", label: "Wünsche", tip: "„Gerne zusammen mit“ in einer Gruppe. Nur wenn Wünsche an sind." },
    { key: "raidBuffs", label: "Raid-Buffs", tip: "Jeder Raid-Buff, den jemand im Raid mitbringt." },
    { key: "attendance", label: "Anwesenheit", tip: "Anwesenheit in dieser Kategorie." },
    { key: "gear", label: "Gear", tip: "„Bereit“ vor „brauchbar“ laut Profil." },
];

const dateTime = (ms: number) => (ms
    ? new Date(ms).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "");

/** Tooltip body of a raider: spec and role, status, then the reasons — one per line. */
function personTip(p: SetupPerson): string {
    const head = [p.specLabel || p.spec, ROLE_LABEL[p.role] || ""].filter(Boolean).join(" · ");
    const lines = [
        head,
        p.main === false ? "Zweitspec" : "",
        p.status && STATUS_LABEL[p.status] ? STATUS_LABEL[p.status] : "",
        p.name ? `@${p.name}` : "",
        ...(p.reasons || []),
    ].filter(Boolean);
    // a status the proposal also names as a reason ("Als Ersatz angemeldet") only once
    return [...new Set(lines)].join("\n");
}

function StatusBadge({ setup }: { setup: StoredSetup }) {
    if (setup.status === "approved") {
        return <Badge tone="ok" tip="Freigegeben" tipSub={`Raider sehen dieses Setup${setup.approvedAt ? ` · seit ${dateTime(setup.approvedAt)}` : ""}.`}>Freigegeben</Badge>;
    }
    if (setup.changedSinceApproval) {
        return (
            <Badge tone="mid" tip="Geändert seit Freigabe" tipSub={`Raider sehen weiter den freigegebenen Stand${setup.approved ? ` vom ${dateTime(setup.approved.approvedAt)}` : ""}, bis du erneut freigibst.`}>
                geändert seit Freigabe
            </Badge>
        );
    }
    const draft = <Badge tone="mid" tip="Entwurf" tipSub="Raider sehen noch nichts. Erst nach der Freigabe erscheint das Setup im Web, in der Event-Nachricht und im Bot.">Entwurf</Badge>;
    if (setup.origin !== "auto") return draft;
    return (
        <>
            {draft}
            <Badge tone="accent" tip="Automatischer Vorschlag" tipSub={`Zum Anmeldeschluss vom EventHelper erstellt${setup.updatedAt ? ` (${dateTime(setup.updatedAt)})` : ""}. Prüfen, anpassen, freigeben.`}>
                automatischer Vorschlag
            </Badge>
        </>
    );
}

type Interaction = {
    editable: boolean;
    selected: string | null;
    dragging: string | null;
    onPick: (userId: string) => void;
    onDrop: (target: SetupTarget, userId?: string) => void;
    onDrag: (userId: string | null) => void;
    onLock: (userId: string) => void;
};

function Slot({ p, ui }: { p: SetupPerson; ui: Interaction }) {
    const color = classColorProps(p.classColor);
    const selected = ui.selected === p.userId;
    const keyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            ui.onPick(p.userId);
        }
    };
    const drop = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        ui.onDrop({ userId: p.userId }, e.dataTransfer.getData("text/plain"));
    };
    return (
        <div
            className={`se-slot${selected ? " se-picked" : ""}${p.locked ? " se-locked" : ""}${ui.dragging === p.userId ? " se-dragging" : ""}`}
            role={ui.editable ? "button" : undefined}
            tabIndex={ui.editable ? 0 : undefined}
            aria-pressed={ui.editable ? selected : undefined}
            draggable={ui.editable}
            data-user={p.userId}
            data-tip={p.character}
            data-tip-sub={personTip(p)}
            onClick={ui.editable ? () => ui.onPick(p.userId) : undefined}
            onKeyDown={ui.editable ? keyDown : undefined}
            // the dimmed look is set a tick later: changing the dragged element inside dragstart makes Chrome cancel the drag
            onDragStart={ui.editable ? (e) => { e.dataTransfer.setData("text/plain", p.userId); e.dataTransfer.effectAllowed = "move"; setTimeout(() => ui.onDrag(p.userId), 0); } : undefined}
            onDragEnd={ui.editable ? () => ui.onDrag(null) : undefined}
            onDragOver={ui.editable ? (e) => e.preventDefault() : undefined}
            onDrop={ui.editable ? drop : undefined}
        >
            <SpecTile iconUrl={p.specIcon ? wowIconUrl(p.specIcon, 36) : undefined} classColor={p.classColor} />
            <span className="se-slot-text">
                <span className={`se-name ${color.className || ""}`} style={color.style}>{p.character}</span>
                <span className="se-sub">
                    {p.specLabel || p.spec}
                    {/* an off-spec role is tinted — "Zweitspec" itself is in the tooltip */}
                    {p.role && <> · <span className={p.main === false ? "se-offrole" : undefined}>{ROLE_LABEL[p.role]}</span></>}
                </span>
            </span>
            {p.status && STATUS_LABEL[p.status] && <span className={`rd-sig rd-sig-${p.status}`} aria-label={STATUS_LABEL[p.status]} />}
            {ui.editable && (
                <IconButton
                    className={`se-lock${p.locked ? " is-on" : ""}`}
                    size="sm"
                    icon={p.locked ? <LockIcon /> : <UnlockIcon />}
                    tip={p.locked ? "Fixiert" : "Fixieren"}
                    tipSub={p.locked ? "Ein neuer Vorschlag lässt diesen Platz, wie er ist. Klick löst die Fixierung." : "Ein neuer Vorschlag soll diesen Platz behalten."}
                    aria-pressed={!!p.locked}
                    onClick={(e) => { e.stopPropagation(); ui.onLock(p.userId); }}
                    onKeyDown={(e) => e.stopPropagation()}
                />
            )}
        </div>
    );
}

/** A drop zone: a group card or the bench. Click/Enter moves the picked raider here. */
function useZone(target: SetupTarget, ui: Interaction) {
    const [over, setOver] = useState(false);
    return {
        over,
        props: ui.editable ? {
            onDragOver: (e: DragEvent<HTMLElement>) => { e.preventDefault(); setOver(true); },
            onDragLeave: () => setOver(false),
            onDrop: (e: DragEvent<HTMLElement>) => { e.preventDefault(); setOver(false); ui.onDrop(target, e.dataTransfer.getData("text/plain")); },
        } : {},
    };
}

function GroupCard({ group, buffs, ui }: { group: SetupEditorGroup; buffs: { key: string; label: string; icon: string }[]; ui: Interaction }) {
    const zone = useZone({ group: group.index }, ui);
    const full = group.slots.length >= GROUP_SIZE;
    const canTake = ui.editable && !!ui.selected && !group.slots.some((s) => s.userId === ui.selected);
    return (
        <section className={`se-group${zone.over ? " se-over" : ""}${canTake ? " se-target" : ""}`} {...zone.props} aria-label={`Gruppe ${group.index}`}>
            <header className="se-group-head">
                <span className="se-group-title">Gruppe {group.index}</span>
                <span className="se-group-buffs">
                    {buffs.map((b) => (
                        <span key={b.key} className="se-buff" data-tip={b.label} data-tip-sub="Gruppen-Buff in dieser Gruppe">
                            <WowIcon name={b.icon} size={18} />
                        </span>
                    ))}
                </span>
                <span className={`se-count${full ? " se-full" : ""}`}>{group.slots.length}/{GROUP_SIZE}</span>
            </header>
            <div className="se-slots">
                {group.slots.map((p) => <Slot key={p.userId} p={p} ui={ui} />)}
                {canTake && !full && (
                    <button type="button" className="se-here" onClick={() => ui.onDrop({ group: group.index })}>Hierher</button>
                )}
                {!group.slots.length && !canTake && <span className="se-empty">leer</span>}
            </div>
        </section>
    );
}

function BenchCard({ bench, ui }: { bench: SetupPerson[]; ui: Interaction }) {
    const zone = useZone({ bench: true }, ui);
    const canTake = ui.editable && !!ui.selected && !bench.some((b) => b.userId === ui.selected);
    return (
        <section className={`se-bench${zone.over ? " se-over" : ""}${canTake ? " se-target" : ""}`} {...zone.props} aria-label="Ersatzbank">
            <header className="se-group-head">
                <span className="se-group-title">Bank</span>
                <span className="se-count">{bench.length}</span>
            </header>
            <div className="se-slots">
                {bench.map((p) => <Slot key={p.userId} p={p} ui={ui} />)}
                {canTake && <button type="button" className="se-here" onClick={() => ui.onDrop({ bench: true })}>Auf die Bank</button>}
                {!bench.length && !canTake && <span className="se-empty">niemand</span>}
            </div>
        </section>
    );
}

function Stat({ label, value, target, ok, tip }: { label: string; value: number; target: string; ok: boolean; tip: string }) {
    return (
        <div className={`se-stat${ok ? "" : " se-off"}`} data-tip={`${label}: ${value}${target ? ` von ${target}` : ""}`} data-tip-sub={tip}>
            <span className="se-stat-v">{value}{target && <small>/{target}</small>}</span>
            <span className="kicker">{label}</span>
        </div>
    );
}

function Summary({ data, setup, busy, onFairness, onWeights }: {
    data: SetupEditorData;
    setup: StoredSetup;
    busy: boolean;
    onFairness: (on: boolean) => void;
    onWeights: () => void;
}) {
    const { checks } = setup;
    const roles = checks.roles || {};
    const tank = roles.tank || { count: 0, min: 0, max: 0, ok: true };
    const healer = roles.healer || { count: 0, min: 0, max: 0, ok: true };
    const dps = dpsCheck(roles);
    // the places the plan leaves for damage dealers: size minus the planned tanks and healers
    const dpsTarget = checks.size.size ? Math.max(0, checks.size.size - (tank.max ?? tank.min) - (healer.max ?? healer.min)) : 0;
    const missingRequired = checks.buffs.required.filter((b) => !b.present);
    const missingRaid = checks.buffs.raid.filter((b) => !b.present);
    const fairness = typeof setup.options?.fairness === "boolean" ? setup.options.fairness : data.event.fairness;
    const wishesOn = typeof setup.options?.wishes === "boolean" ? setup.options.wishes : data.event.wishes;
    const buffTip = [
        checks.buffs.required.length ? `Pflicht: ${checks.buffs.required.map((b) => `${b.present ? "✓" : "–"} ${b.label}`).join(", ")}` : "Keine Pflicht-Buffs in der Raid-Vorlage.",
        missingRaid.length ? `Bringt niemand mit: ${missingRaid.map((b) => b.label).join(", ")}` : "Alle Raid-Buffs sind da.",
    ].join("\n");
    return (
        <aside className="se-side" aria-label="Zusammenfassung">
            <div className="se-stats">
                <Stat label="Tanks" value={tank.count} target={roleTarget(tank)} ok={tank.ok} tip="Soll aus dem Event-Plan." />
                <Stat label="Heiler" value={healer.count} target={roleTarget(healer)} ok={healer.ok} tip="Soll aus dem Event-Plan." />
                <Stat
                    label="DD" value={dps.count} target={dpsTarget ? String(dpsTarget) : ""} ok={dps.ok && dps.count >= dpsTarget}
                    tip={`Nahkampf ${roles.melee?.count || 0} · Fernkampf ${roles.ranged?.count || 0}`}
                />
            </div>
            <div className="se-side-row">
                <span className="kicker">Buffs</span>
                {missingRequired.length
                    ? <Badge tone="bad" tip="Pflicht-Buff fehlt" tipSub={buffTip}>{missingRequired.length} Pflicht fehlt</Badge>
                    : <Badge tone={missingRaid.length ? "mid" : "ok"} tip="Buffs" tipSub={buffTip}>{missingRaid.length ? `${missingRaid.length} Raid-Buff fehlt` : "vollständig"}</Badge>}
            </div>
            <div className="se-side-row">
                <span className="kicker" data-tip="Fairness" data-tip-sub="Wer zuletzt auf der Bank saß, kommt beim nächsten Vorschlag eher mit.">Fairness</span>
                <label className="switch">
                    <input type="checkbox" checked={fairness} disabled={busy} onChange={() => onFairness(!fairness)} aria-label="Fairness beim Vorschlag berücksichtigen" />
                    <span className="switch-track"><span className="switch-thumb" /></span>
                </label>
            </div>
            <div className="se-side-row">
                <span className="kicker">Wünsche</span>
                {wishesOn
                    ? <span className="se-side-v" data-tip="Wünsche erfüllt" data-tip-sub="„Gerne zusammen mit“-Paare in derselben Gruppe. Nur für die Orga sichtbar.">{checks.wishes.met}<small>/{checks.wishes.total}</small></span>
                    : <span className="se-side-off" data-tip="Wünsche aus" data-tip-sub="Für dieses Event werden Wünsche nicht berücksichtigt.">aus</span>}
            </div>
            <button type="button" className="se-weights-btn" onClick={onWeights} disabled={busy}>Gewichte…</button>
            {!!setup.warnings.length && (
                <Badge tone="mid" tip="Hinweise" tipSub={setup.warnings.join("\n")}>{setup.warnings.length} Hinweis{setup.warnings.length === 1 ? "" : "e"}</Badge>
            )}
        </aside>
    );
}

function WeightsModal({ open, onClose, data, setup, onApply }: {
    open: boolean;
    onClose: () => void;
    data: SetupEditorData;
    setup: StoredSetup;
    onApply: (weights: Record<string, number>) => void;
}) {
    const defaults = data.defaults?.weights || {};
    const max = data.defaults?.maxWeight || 500;
    const [values, setValues] = useState<Record<string, number>>({});
    useEffect(() => {
        if (open) setValues({ ...defaults, ...(setup.options?.weights || {}) });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);
    const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => defaults[k] !== v));
    return (
        <Modal
            open={open} onClose={onClose} icon="inv_misc_gear_01" tone="raids" kicker="Setup-Vorschlag" title="Gewichte" width={520}
            hint="Wirkt beim nächsten Vorschlag. Rollen und Raidgröße gehen immer vor."
            footer={(
                <>
                    <Button variant="ghost" onClick={() => setValues({ ...defaults })}>Standard</Button>
                    <Button icon="spell_holy_borrowedtime" onClick={() => onApply(changed)}>Neu vorschlagen</Button>
                </>
            )}
        >
            <div className="se-weights">
                {WEIGHT_LABELS.map((w) => (
                    <label key={w.key} className="se-weight">
                        <span className="se-weight-label" data-tip={w.label} data-tip-sub={w.tip}>{w.label}</span>
                        <input
                            type="range" min={0} max={max} step={10} value={values[w.key] ?? 0}
                            onChange={(e) => setValues((v) => ({ ...v, [w.key]: Number(e.target.value) }))}
                            aria-label={w.label}
                        />
                        <span className={`se-weight-v${defaults[w.key] !== values[w.key] ? " se-changed" : ""}`}>{values[w.key] ?? 0}</span>
                    </label>
                ))}
            </div>
        </Modal>
    );
}

function ExplainModal({ open, onClose, ctx, data, setup, onDone }: {
    open: boolean;
    onClose: () => void;
    ctx: RaidCtx;
    data: SetupEditorData;
    setup: StoredSetup;
    onDone: () => void;
}) {
    const jobs = useJobs();
    const [running, setRunning] = useState(false);
    const explanation = setup.explanation;
    const outdated = !!explanation && explanation.version !== setup.version;
    const start = async () => {
        setRunning(true);
        await jobs.run({ label: "KI-Begründung", detail: data.event.title, icon: "inv_scroll_03", expectedSeconds: 30 }, async () => {
            await explainRaidSetup(ctx.csrfToken, ctx.eventId);
            for (;;) {
                await new Promise((r) => setTimeout(r, 2000));
                const state = await getRaidSetupExplain(ctx.eventId);
                if (!state.job || state.job.status === "done") return state;
                if (state.job.status === "error") throw new Error(state.job.error || "KI-Begründung fehlgeschlagen.");
            }
        });
        setRunning(false);
        onDone();
    };
    return (
        <Modal
            open={open} onClose={onClose} icon="inv_scroll_03" tone="raids" kicker="Setup · nur für die Orga" title="KI-Begründung" width={640}
            hint="Erklärt nur – das Setup ändert sich dadurch nie."
            footer={data.hasApiKey
                ? <Button variant="run" icon="spell_holy_borrowedtime" running={running} onClick={start}>{explanation ? "Neu erstellen" : "Erstellen"}</Button>
                : <Link className="btn btn-ghost" to="/settings?section=verbindungen">Schlüssel hinterlegen</Link>}
        >
            {!data.hasApiKey && <p className="se-note">Ohne Anthropic-Schlüssel (Einstellungen › Verbindungen) gibt es keine KI-Begründung.</p>}
            {explanation
                ? (
                    <div className="se-explain">
                        <div className="se-explain-meta">
                            <Badge tone={outdated ? "mid" : "ok"}>{outdated ? `zu Version ${explanation.version} – veraltet` : `Version ${explanation.version}`}</Badge>
                            <span className="kicker">{dateTime(explanation.at)}</span>
                        </div>
                        <div className="se-explain-text">{explanation.text}</div>
                    </div>
                )
                : data.hasApiKey && <p className="se-note">Noch keine Begründung für dieses Setup.</p>}
        </Modal>
    );
}

const clock = (ms: number) => {
    if (!ms) return "";
    const d = new Date(ms);
    const sameDay = d.toDateString() === new Date().toDateString();
    return d.toLocaleString("de-DE", sameDay
        ? { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }
        : { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

/**
 * One calm line under the bar (#290): before the approval what it will post and
 * send, after it what it did — the details in the tooltip, one "Setup posten".
 */
function PublishLine({ data, setup, busy, posting, onPost }: {
    data: SetupEditorData;
    setup: StoredSetup;
    busy: boolean;
    posting: boolean;
    onPost: () => void;
}) {
    const hint = publishHint(data.publish, setup.status === "approved", clock);
    if (!hint) return null;
    return (
        <div className={`se-publish${hint.tone ? ` se-publish-${hint.tone}` : ""}`}>
            <WowIcon name="inv_letter_15" size={18} />
            <span className="se-publish-text" data-tip={hint.tip} data-tip-sub={hint.sub}>{hint.text}</span>
            {!data.publish?.dmsEnabled && !hint.canPost && !data.publish?.cancelled && (
                <Link className="se-publish-link" to="/settings?section=kategorien">DMs einschalten</Link>
            )}
            {hint.canPost && (
                <Button
                    variant="ghost" size="sm" icon="inv_letter_15" running={posting || hint.running} disabled={busy}
                    data-tip="Setup posten"
                    data-tip-sub="Postet das freigegebene Setup in den Event-Kanal oder aktualisiert die Nachricht dort und schickt DMs, die noch fehlen. Ein Entwurf wird nie gepostet."
                    onClick={onPost}
                >
                    Setup posten
                </Button>
            )}
        </div>
    );
}

/** The approved lineup, read-only — what someone without write access sees. */
function ReadOnly({ data }: { data: SetupEditorData }) {
    const approved = data.approved;
    const ui: Interaction = { editable: false, selected: null, dragging: null, onPick: () => {}, onDrop: () => {}, onDrag: () => {}, onLock: () => {} };
    if (!approved) return <p className="rd-empty">Das Setup ist noch nicht freigegeben.</p>;
    const groupCount = Math.max(1, Math.ceil((data.event.size || 0) / GROUP_SIZE));
    return (
        <div className="se-layout se-readonly">
            <div className="se-groups">
                {withAllGroups(approved.groups, groupCount).map((g) => <GroupCard key={g.index} group={g} buffs={[]} ui={ui} />)}
            </div>
            <BenchCard bench={approved.bench} ui={ui} />
        </div>
    );
}

export default function SetupEditor({ ctx }: { ctx: RaidCtx }) {
    const jobs = useJobs();
    const ask = useConfirm();
    const [data, setData] = useState<SetupEditorData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [busy, setBusy] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);
    const [dragging, setDragging] = useState<string | null>(null);
    const [dialog, setDialog] = useState<"weights" | "explain" | null>(null);
    const [posting, setPosting] = useState(false);
    const saving = useRef(0);

    const load = useCallback(() => {
        getRaidSetup(ctx.eventId).then((d) => { setData(d); setError(null); }).catch((e: ApiError) => setError(e));
    }, [ctx.eventId]);
    useEffect(load, [load]);

    useEffect(() => {
        if (!selected) return undefined;
        const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
        document.addEventListener("keydown", esc);
        return () => document.removeEventListener("keydown", esc);
    }, [selected]);

    const setup = data?.setup || null;

    // The DMs of an approval run on in the background: poll only their state, so
    // a move the orga makes meanwhile is never overwritten by an older lineup.
    const dmsRunning = data?.publish?.dms?.status === "running";
    useEffect(() => {
        if (!dmsRunning) return undefined;
        const timer = setInterval(() => {
            getRaidSetup(ctx.eventId)
                .then((next) => setData((prev) => (prev ? { ...prev, publish: next.publish } : prev)))
                .catch(() => undefined);
        }, 3000);
        return () => clearInterval(timer);
    }, [dmsRunning, ctx.eventId]);

    // Moves come faster than answers. Every save waits for the one before it and
    // carries the version the server last confirmed, and the next move builds on
    // the lineup as drawn (current.data) — so quick moves never trip the
    // server's "changed in the meantime" check on their own.
    const current = useRef<SetupEditorData | null>(null);
    current.current = data;
    const confirmedVersion = useRef(0);
    const chain = useRef<Promise<unknown>>(Promise.resolve());
    useEffect(() => { if (data?.setup && !saving.current) confirmedVersion.current = data.setup.version; }, [data]);

    /** A server answer, with the Discord names the page already knows (mutations do not resolve them again). */
    const withNames = (next: SetupEditorData): SetupEditorData => {
        if (!next.setup) return next;
        const known = current.current?.setup ? peopleOf(current.current.setup) : new Map<string, SetupPerson>();
        const named = (p: SetupPerson) => (p.name ? p : { ...p, name: known.get(p.userId)?.name || "" });
        return { ...next, setup: { ...next.setup, groups: next.setup.groups.map((g) => ({ ...g, slots: g.slots.map(named) })), bench: next.setup.bench.map(named) } };
    };

    /** Answer of a mutating call: take the server's lineup, tell the parent the step changed. */
    const accept = (next: SetupEditorData, message?: string) => {
        if (next.setup) confirmedVersion.current = next.setup.version;
        setData(withNames(next));
        ctx.onChanged(message || "");
    };

    const save = (input: SetupPlacementInput, extra: { fairness?: boolean } = {}) => {
        const shown = current.current;
        if (!shown?.setup) return chain.current;
        const ticket = ++saving.current;
        setData({ ...shown, setup: applyLocal(shown.setup, input) });
        chain.current = chain.current.then(async () => {
            try {
                const next = await saveRaidSetup(ctx.csrfToken, ctx.eventId, { ...input, ...extra, version: confirmedVersion.current });
                if (next.setup) confirmedVersion.current = next.setup.version;
                // only the last pending save redraws; earlier answers would flash an older lineup
                if (ticket === saving.current) {
                    saving.current = 0;
                    accept(next);
                }
            } catch (e) {
                saving.current = 0;
                jobs.notify((e as ApiError).message || "Speichern fehlgeschlagen.", "err");
                load();
            }
        });
        return chain.current;
    };

    const move = (target: SetupTarget, userId?: string) => {
        const who = userId || selected;
        setSelected(null);
        setDragging(null);
        const shown = current.current;
        if (!who || !shown?.setup) return;
        const result = moveRaider(toInput(shown.setup), who, target, peopleOf(shown.setup), shown.event.size || 0);
        if ("error" in result && result.error) return jobs.notify(result.error, "err");
        if (result.input) save(result.input);
    };

    const pick = (userId: string) => {
        if (!selected) return setSelected(userId);
        if (selected === userId) return setSelected(null);
        move({ userId });
    };

    const propose = async (weights?: Record<string, number>) => {
        setBusy(true);
        setDialog(null);
        await chain.current;
        const next = await jobs.run({ label: "Setup-Vorschlag", detail: data?.event.title || "", icon: "inv_misc_map_01", quiet: true }, () => (
            proposeRaidSetup(ctx.csrfToken, ctx.eventId, weights ? { weights } : {})
        ));
        setBusy(false);
        if (next) accept(next, next.message);
    };

    const approve = async () => {
        if (!setup) return;
        if (!setup.checks.ok) {
            const okay = await ask({
                title: "Trotzdem freigeben?",
                text: "Das Setup erfüllt nicht alle Prüfungen (Rollen, Größe oder Pflicht-Buffs). Raider sehen es nach der Freigabe so, wie es ist.",
                action: "Freigeben",
                icon: "inv_misc_map_01",
            });
            if (!okay) return;
        }
        setBusy(true);
        try {
            // approve what is drawn: wait for the moves still on their way first
            await chain.current;
            const next = await approveRaidSetup(ctx.csrfToken, ctx.eventId, confirmedVersion.current);
            accept(next, next.message);
        } catch (e) {
            jobs.notify((e as ApiError).message || "Freigabe fehlgeschlagen.", "err");
            load();
        } finally {
            setBusy(false);
        }
    };

    const post = async () => {
        setPosting(true);
        try {
            await chain.current;
            const next = await publishRaidSetup(ctx.csrfToken, ctx.eventId);
            accept(next, next.message);
        } catch (e) {
            jobs.notify((e as ApiError).message || "Posten fehlgeschlagen.", "err");
            load();
        } finally {
            setPosting(false);
        }
    };

    if (error) return <div className="empty">Setup nicht geladen: {error.message}</div>;
    if (!data) return <RaidLoader text="Setup wird geladen" compact />;
    if (!data.canWrite) return <ReadOnly data={data} />;

    if (!setup) {
        return (
            <div className="se-start">
                <WowIcon name="inv_misc_map_01" size={40} />
                <div>
                    <div className="se-start-title">Noch kein Setup</div>
                    <div className="se-start-sub">{data.signupCount || 0} angemeldet{data.absent ? ` · ${data.absent} abgemeldet` : ""} · {data.event.size} Plätze</div>
                </div>
                <Button icon="spell_holy_borrowedtime" running={busy} disabled={!data.signupCount} onClick={() => propose()}>Vorschlag erstellen</Button>
            </div>
        );
    }

    const ui: Interaction = { editable: !busy, selected, dragging, onPick: pick, onDrop: move, onDrag: setDragging, onLock: (userId) => save(toggleLock(toInput(current.current?.setup || setup), userId)) };
    const groups = withAllGroups(setup.groups, data.groupCount || 1);
    const partyBuffs = setup.checks.buffs.party;
    const lockedCount = [...setup.groups.flatMap((g) => g.slots), ...setup.bench].filter((p) => p.locked).length;
    const size = setup.checks.size;

    return (
        <div className="se-editor">
            <div className="se-bar">
                <StatusBadge setup={setup} />
                <Badge tone={size.ok ? undefined : "mid"} tip="Plätze" tipSub={`${size.count} von ${size.size} Plätzen besetzt · ${setup.bench.length} auf der Bank`}>{size.count}/{size.size} Plätze</Badge>
                {lockedCount > 0 && <Badge tone="accent" icon={<LockIcon />} tip="Fixiert" tipSub="Diese Plätze behält ein neuer Vorschlag.">{lockedCount} fixiert</Badge>}
                <span className="se-bar-hint">
                    {selected ? "Ziel wählen – Gruppe, Bank oder Raider · Esc" : "Ziehen oder anklicken zum Umstellen"}
                </span>
                <div className="se-bar-act">
                    <Button variant="ghost" size="sm" icon="inv_scroll_03" onClick={() => setDialog("explain")}>KI-Begründung</Button>
                    <Button variant="ghost" size="sm" icon="spell_holy_borrowedtime" disabled={busy} onClick={() => propose()}>Neu vorschlagen</Button>
                    <Button size="sm" icon="achievement_guildperk_everybodysfriend" disabled={busy || setup.status === "approved"} onClick={approve}>
                        {setup.status === "approved" ? "Freigegeben" : "Freigeben"}
                    </Button>
                </div>
            </div>
            <PublishLine data={data} setup={setup} busy={busy} posting={posting} onPost={post} />

            <div className="se-layout">
                <div className="se-groups">
                    {groups.map((g) => (
                        <GroupCard key={g.index} group={g} ui={ui} buffs={partyBuffs.filter((b) => b.groups.includes(g.index))} />
                    ))}
                </div>
                <BenchCard bench={setup.bench} ui={ui} />
                <Summary
                    data={data} setup={setup} busy={busy}
                    onFairness={(on) => save(toInput(current.current?.setup || setup), { fairness: on })}
                    onWeights={() => setDialog("weights")}
                />
            </div>

            <WeightsModal open={dialog === "weights"} onClose={() => setDialog(null)} data={data} setup={setup} onApply={(w) => propose(w)} />
            <ExplainModal open={dialog === "explain"} onClose={() => setDialog(null)} ctx={ctx} data={data} setup={setup} onDone={load} />
        </div>
    );
}

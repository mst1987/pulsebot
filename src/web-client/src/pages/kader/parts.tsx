// Small pieces every view of the Kaderplaner draws the same way: WoW icons of
// class, spec and role — a spec is shown as its icon plus the class name, the
// full "Schamane · Wiederherstellung" sits in the tooltip —, a player's name (it
// opens the account dialog), the state with its icon and "seit … (wer)", the
// source of a prefilled character, the initial of a lead, counts that say what
// they count, the status of an interview (open circle, progress ring, check),
// votes, empty states, a switch, the week squares, the head of a sub page, the
// two tabs of the Vorauswahl and what an interview says (wishes, answers,
// history).
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { KaderEntry, KaderPrefill, KaderQuestion, KaderAnswer, KaderRole, KaderState, KaderVote, KaderWish } from "../../api";
import { classColorProps } from "../../components/ClassSpec";
import {
    BenchIcon, CheckIcon, ChevronLeftIcon, CircleIcon, CrestIcon, HourglassIcon, ListChecksIcon, RosterIcon, TentativeIcon, XIcon,
} from "../../components/icons";
import { WowIcon } from "../../components/ui";
import { useT } from "../../i18n";
import { ROLE_ICON } from "../../lib/raidplan/assign";
import { roleLabel } from "../../lib/wowNames";
import { classColor, classIconOf, className, dayOf, historyText, nameOf, playerName, specIconOf, specName, wishLabel } from "../../lib/kader/model";
import { answerLabels, dayShort, isWeekdays, progress, statusOf } from "../../lib/kader/interview";
import { useKader, type KaderSub } from "./kaderContext";

/**
 * A WoW icon with a name: rounded, with the name as its accessible label and
 * tooltip. Nothing without an icon name.
 */
export function KIcon({ name, label, size = 20, tip = true }: { name: string; label: string; size?: number; tip?: boolean }) {
    if (!name) return null;
    return (
        <span className="kp-ico" role="img" aria-label={label} data-tip={tip ? label : undefined}>
            <WowIcon name={name} size={size} />
        </span>
    );
}

/** A spec's icon ("Warrior-Protection"), named in the menu language: "Schutz · Krieger". */
export function SpecIcon({ specKey, size = 20 }: { specKey: string | null | undefined; size?: number }) {
    const { view } = useKader();
    if (!specKey) return null;
    return <KIcon name={specIconOf(view.classes, specKey)} label={`${specName(view.classes, specKey)} · ${className(view.classes, specKey.split("-")[0])}`} size={size} />;
}

/** A class's icon ("Warrior"). */
export function ClassIcon({ classKey, size = 20 }: { classKey: string; size?: number }) {
    const { view } = useKader();
    return <KIcon name={classIconOf(view.classes, classKey)} label={className(view.classes, classKey)} size={size} />;
}

/** The role icon the raid detail and the raid plan use for their role groups. */
export function RoleIcon({ role, size = 20 }: { role: KaderRole; size?: number }) {
    return <KIcon name={ROLE_ICON[role] || ""} label={roleLabel(role)} size={size} tip={false} />;
}

/** The icon of a class/spec pair: the spec's, else the class's, else an empty square of the same size. */
export function PickIcon({ pick, size = 20 }: { pick: KaderWish | null | undefined; size?: number }) {
    if (pick && pick.spec) return <SpecIcon specKey={pick.spec} size={size} />;
    if (pick && pick.className) return <ClassIcon classKey={pick.className} size={size} />;
    return <span className="kp-ico kp-ico-none" style={{ "--ico": `${size}px` } as CSSProperties} aria-hidden="true" />;
}

/** The class of a class/spec pair in its colour ("Schamane"); the spec icon beside it says the rest, the tooltip spells it out. */
export function PickLabel({ pick, className: extra = "" }: { pick: KaderWish | null | undefined; className?: string }) {
    const { view } = useKader();
    const t = useT();
    if (!pick) return <span className={`kp-muted ${extra}`.trim()}>{t("kader.player.noChar")}</span>;
    const props = classColorProps(classColor(view.classes, pick.className));
    return (
        <span className={[extra, props.className].filter(Boolean).join(" ")} style={props.style} data-tip={wishLabel(view.classes, pick)}>
            {className(view.classes, pick.className)}
        </span>
    );
}

/** Spec icon plus class name: how the planer names what somebody plays ("[Resto-Icon] Schamane"). */
export function SpecTag({ pick, size = 20, className: extra = "" }: { pick: KaderWish | null | undefined; size?: number; className?: string }) {
    return (
        <span className={`kp-spectag ${extra}`.trim()}>
            <PickIcon pick={pick} size={size} />
            <PickLabel pick={pick} className="kp-ellipsis" />
        </span>
    );
}

/** The wishes as a compact row of numbered spec icons: "1 [icon] 2 [icon]". */
export function WishIcons({ wishes, max = 3, size = 18 }: { wishes: KaderWish[]; max?: number; size?: number }) {
    const t = useT();
    if (!wishes.length) return <span className="kp-muted">{t("kader.interview.noWishes")}</span>;
    return (
        <span className="kp-wishicons">
            {wishes.slice(0, max).map((w, i) => (
                <span key={`${w.spec}-${i}`} className="kp-wishicon">
                    <span className="kp-mono">{i + 1}</span>
                    <PickIcon pick={w} size={size} />
                </span>
            ))}
            {wishes.length > max && <span className="kp-muted">+{wishes.length - max}</span>}
        </span>
    );
}

/** A player's name; with write or read access it opens the account dialog (the characters of the account). */
export function PlayerName({ userId, entry, className: extra = "" }: { userId: string; entry?: KaderEntry; className?: string }) {
    const { view, open } = useKader();
    return (
        <button type="button" className={`kp-namebtn ${extra}`.trim()} onClick={() => open({ type: "account", userId })}>
            {playerName(view, userId, entry)}
        </button>
    );
}

const STATE_ICONS: Record<KaderState, ComponentType> = {
    pool: RosterIcon,
    selected: ListChecksIcon,
    provisional: HourglassIcon,
    roster: CrestIcon,
    bench: BenchIcon,
    tentative: TentativeIcon,
};

/** The line icon of a state (Pool = people, Vorauswahl = checklist, Vorläufig = hourglass, Roster = shield, Bench, Tentative = ?). */
export function StateIcon({ state }: { state: KaderState }) {
    const Icon = STATE_ICONS[state];
    return <span className={`kp-sico kp-sico-${state}`} aria-hidden="true"><Icon /></span>;
}

/** The state of a player, as a small badge with its icon. */
export function StateBadge({ state }: { state: KaderState }) {
    const t = useT();
    return <span className={`kp-state kp-st-${state}`}><StateIcon state={state} />{t(`kader.state.${state}`)}</span>;
}

/** "seit 30.09. (Kurt)" — since when and by whom a player stands where they stand. */
export function SinceText({ entry }: { entry: KaderEntry }) {
    const { view } = useKader();
    const t = useT();
    if (!entry.since) return null;
    return <>{t("kader.since", { date: dayOf(entry.since), by: nameOf(view, entry.by) })}</>;
}

/** "in der Vorauswahl seit 30.09. (Kurt)" — the state in words, with since when and by whom. */
export function StateSince({ entry }: { entry: KaderEntry }) {
    const { view } = useKader();
    const t = useT();
    return <>{t(`kader.stateSince.${entry.state}`, { date: dayOf(entry.since) || "—", by: nameOf(view, entry.by) })}</>;
}

/** Where a prefilled character comes from: Profil, Logs, manuell (the planner's own data) or fehlt. */
export function SourceBadge({ prefill }: { prefill: KaderPrefill }) {
    const t = useT();
    const source = prefill ? prefill.source : "none";
    const label = t(`kader.source.${source}`);
    const tip = prefill && prefill.versionId ? t("kader.source.otherVersion", { version: prefill.versionId.toUpperCase() }) : t("kader.source.tip");
    return <span className={`kp-source kp-src-${source}`} data-tip={tip}>{label}</span>;
}

/** The initial of a lead in a small circle, the full name as its tooltip. */
export function Avatar({ userId, index = 0 }: { userId: string; index?: number }) {
    const { view } = useKader();
    const name = nameOf(view, userId);
    return <span className={`kp-avatar kp-hue-${index % 4}`} role="img" aria-label={name} data-tip={name}>{(name.trim()[0] || "?").toUpperCase()}</span>;
}

/** A number that says what it counts: the figure as a badge, the words in the tooltip and for screen readers. */
export function Count({ n, tip, className: extra = "" }: { n: number; tip: string; className?: string }) {
    return (
        <span className={`kp-count ${extra}`.trim()} data-tip={tip}>
            <span aria-hidden="true">{n}</span>
            <span className="kp-sr">{tip}</span>
        </span>
    );
}

/** A ring filled to done/total: an interview under way. */
export function ProgressRing({ done, total }: { done: number; total: number }) {
    const r = 8;
    const c = 2 * Math.PI * r;
    const frac = total ? Math.max(0, Math.min(1, done / total)) : 0;
    return (
        <svg className="kp-ring" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeWidth="2.6" opacity="0.3" />
            <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"
                strokeDasharray={`${(c * frac).toFixed(2)} ${c.toFixed(2)}`} transform="rotate(-90 12 12)" />
        </svg>
    );
}

/** The icon of an interview's status: an empty circle (offen), the progress ring (angefangen), a check (geführt). */
export function InterviewIcon({ entry }: { entry: KaderEntry }) {
    const { kader } = useKader();
    const status = statusOf(entry);
    if (status === "done") return <CheckIcon />;
    if (status === "open") return <CircleIcon />;
    const p = progress(entry, kader.questions);
    return <ProgressRing done={p.done} total={p.total} />;
}

/** Where an interview stands: ○ offen, ◔ 3/5 while it runs, ✓ geführt. */
export function InterviewChip({ entry }: { entry: KaderEntry }) {
    const t = useT();
    const { kader } = useKader();
    const status = statusOf(entry);
    const p = progress(entry, kader.questions);
    const tip = status === "done" ? t("kader.interview.statusDoneTip") : status === "open" ? t("kader.interview.statusOpenTip") : t("kader.interview.progress", { done: p.done, total: p.total });
    const text = status === "done" ? t("kader.interview.statusDone") : status === "open" ? t("kader.interview.statusOpen") : `${p.done}/${p.total}`;
    return (
        <span className={`kp-ivchip kp-iv-${status}`} data-tip={tip}>
            <InterviewIcon entry={entry} />
            <span aria-hidden={status === "started" ? "true" : undefined}>{text}</span>
            {status === "started" && <span className="kp-sr">{tip}</span>}
        </span>
    );
}

/** The small check beside the name of somebody whose interview is held. */
export function DoneBadge() {
    const t = useT();
    return <span className="kp-donebadge" role="img" aria-label={t("kader.interview.statusDoneTip")} data-tip={t("kader.interview.statusDoneTip")}><CheckIcon /></span>;
}

/** The icon of a vote: dafür = check, unsicher = question mark, dagegen = x. */
export function VoteIcon({ vote }: { vote: KaderVote }) {
    if (vote === "yes") return <CheckIcon />;
    if (vote === "no") return <XIcon />;
    return <TentativeIcon />;
}

/** An empty list: a quiet icon above the text, actions below. */
export function EmptyState({ icon, text, children }: { icon: ReactNode; text: string; children?: ReactNode }) {
    return (
        <div className="kp-empty">
            <span className="kp-empty-ico" aria-hidden="true">{icon}</span>
            <p>{text}</p>
            {children}
        </div>
    );
}

/** An on/off switch with its state as text ("Ja"/"Nein"). */
export function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (on: boolean) => void }) {
    const t = useT();
    return (
        <button type="button" role="switch" aria-checked={on} aria-label={label} className={`kp-switch${on ? " kp-on" : ""}`} disabled={disabled} onClick={() => onChange(!on)}>
            <span className="kp-track" aria-hidden="true"><i /></span>
            <span className="kp-switch-text">{on ? t("common.yes") : t("common.no")}</span>
        </button>
    );
}

/** A grip for dragging, drawn as six dots. */
export function Grip() {
    return (
        <svg className="kp-grip" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
            <circle cx="6" cy="4" r="1.3" /><circle cx="10" cy="4" r="1.3" />
            <circle cx="6" cy="8" r="1.3" /><circle cx="10" cy="8" r="1.3" />
            <circle cx="6" cy="12" r="1.3" /><circle cx="10" cy="12" r="1.3" />
        </svg>
    );
}

/** The answer to a weekday question as seven squares. */
export function DaySquares({ question, value }: { question: KaderQuestion; value: KaderAnswer | undefined }) {
    const picked = Array.isArray(value) ? value : [];
    const on = question.options.filter((o) => picked.includes(o.id)).map((o) => dayShort(o.label));
    const label = on.length ? on.join(", ") : "—";
    return (
        <span className="kp-week" role="img" aria-label={label} data-tip={label}>
            {question.options.map((o) => <i key={o.id} className={picked.includes(o.id) ? "on" : ""} />)}
        </span>
    );
}

/** The head of a sub page (Fragen, Beispiel-Setups): back to its step, kicker and title, actions on the right. */
export function SubHead({ back, backLabel, kicker, title, children }: { back: KaderSub; backLabel: string; kicker: string; title: string; children?: ReactNode }) {
    const { kader } = useKader();
    return (
        <div className="kp-subhead">
            <Link to={`/kader/${kader.id}/${back}`} className="kp-back"><ChevronLeftIcon />{backLabel}</Link>
            <span className="kp-vrule" aria-hidden="true" />
            <div className="kp-subhead-text">
                <div className="kicker">{kicker}</div>
                <h2>{title}</h2>
            </div>
            {children && <div className="kp-subhead-act">{children}</div>}
        </div>
    );
}

/** Gespräche | Übersicht, the two views of the Vorauswahl; more controls follow in the same row. */
export function SelectionTabs({ sub, children }: { sub: "vorauswahl" | "uebersicht"; children?: ReactNode }) {
    const t = useT();
    const { kader } = useKader();
    return (
        <div className="kp-toolbar">
            <nav className="kp-tabs" aria-label={t("kader.nav.selection")}>
                {(["vorauswahl", "uebersicht"] as const).map((s) => (
                    <Link key={s} to={`/kader/${kader.id}/${s}`} className={`kp-tab${s === sub ? " kp-active" : ""}`} aria-current={s === sub ? "page" : undefined}>
                        {t(`kader.nav.${s}`)}
                    </Link>
                ))}
            </nav>
            {children}
        </div>
    );
}

/** The wishes of an entry, numbered, as spec icon plus class ("1. [icon] Schamane"). */
export function WishLines({ wishes }: { wishes: KaderWish[] }) {
    const t = useT();
    if (!wishes.length) return <span className="kp-muted">{t("kader.interview.noWishes")}</span>;
    return (
        <ol className="kp-wishlines">
            {wishes.map((w, i) => (
                <li key={`${w.spec}-${i}`}>
                    <span className="kp-mono kp-muted">{i + 1}.</span>
                    <SpecTag pick={w} size={18} />
                </li>
            ))}
        </ol>
    );
}

/** The answers of an interview as label and value; an open required question in the warning colour. */
export function AnswerLines({ entry, questions }: { entry: KaderEntry; questions: KaderQuestion[] }) {
    const t = useT();
    if (!questions.length) return null;
    return (
        <dl className="kp-answers">
            {questions.map((q) => {
                const labels = answerLabels(q, entry.interview.answers[q.id]);
                const text = isWeekdays(q) ? labels.map(dayShort).join(" · ") : labels.join(" · ");
                return (
                    <div key={q.id}>
                        <dt>{q.text}</dt>
                        {labels.length
                            ? <dd>{text}</dd>
                            : <dd className={q.required ? "kp-warntext" : "kp-muted"}>{q.required ? t("kader.interview.stillOpen") : "—"}</dd>}
                    </div>
                );
            })}
        </dl>
    );
}

/** What happened to a player in this Kader, newest first ("02.10. Vorauswahl → Vorläufig (Kurt)"). */
export function HistoryLines({ entry, limit = 0 }: { entry: KaderEntry; limit?: number }) {
    const { view } = useKader();
    const items = [...entry.history].reverse();
    return (
        <ul className="kp-history">
            {(limit ? items.slice(0, limit) : items).map((h, i) => (
                <li key={`${h.at}-${i}`}>
                    <span className="kp-mono kp-muted">{dayOf(h.at)}</span>
                    <span className="kp-grow">{historyText(view, h)}</span>
                    <span className="kp-muted">{nameOf(view, h.by)}</span>
                </li>
            ))}
        </ul>
    );
}

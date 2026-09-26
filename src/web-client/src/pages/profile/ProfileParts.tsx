import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { searchRaiders, type GameClass, type ProfileData, type RaiderProfile, type RaiderRef } from "../../api";
import { Expand, IconButton, Segment, WowIcon } from "../../components/ui";
import { classColorProps } from "../../components/ClassSpec";
import { XIcon, SearchIcon } from "../../components/icons";
import { instanceName } from "../../lib/wowNames";
import { useT } from "../../i18n";

// "Mein Profil" (#255): the raider's own page. Deliberately calm — the
// characters on top, the selected character's specs as the one big thing, and
// everything else (when, which raids, with whom, a note) folded in a side column
// that shows one line per part until it is opened. Every change saves itself;
// there is no form to submit.

export type Fold = "days" | "raids" | "wishes" | "avoid" | "note" | "calendar" | "";

/**
 * "Nicht mit X raiden": off until the raider switches it on — past a question
 * that reminds them everyone deserves a chance. Only the orga reads it, and
 * only when it asks for it while building a setup. Switching it off forgets
 * the names.
 */
export function AvoidPart({ profile, max, classes, onEnable, onChange }: {
    profile: RaiderProfile;
    max: number;
    classes: GameClass[];
    onEnable: (on: boolean) => void;
    onChange: (next: RaiderRef[]) => void;
}) {
    const t = useT();
    return (
        <div className="pf-avoid">
            <label className="pf-avoid-switch">
                <span className="pf-avoid-label">{t("profile.avoid.switch")}</span>
                <span className="switch">
                    <input type="checkbox" checked={profile.avoidEnabled} onChange={(e) => onEnable(e.target.checked)} aria-label={t("profile.avoid.switch")} />
                    <span className="switch-track"><span className="switch-thumb" /></span>
                </span>
            </label>
            {profile.avoidEnabled
                ? (
                    <WishPicker
                        wishes={profile.avoid}
                        max={max}
                        classes={classes}
                        exclude={profile.wishes}
                        hint={t("profile.avoid.hint")}
                        onChange={onChange}
                    />
                )
                : <p className="pf-muted">{t("profile.avoid.offText")}</p>}
        </div>
    );
}

/** One foldable part of the side column: title and a one-line summary, the body only when open. */
export function FoldPart({ id, open, onOpen, title, summary, badge, children }: {
    id: Exclude<Fold, "">;
    open: Fold;
    onOpen: (f: Fold) => void;
    title: string;
    summary: ReactNode;
    badge?: ReactNode;
    children: ReactNode;
}) {
    const isOpen = open === id;
    return (
        <section className={`pf-fold${isOpen ? " is-open" : ""}`}>
            <div className="pf-fold-head">
                <button type="button" className="pf-fold-title" onClick={() => onOpen(isOpen ? "" : id)}>
                    <span className="pf-fold-name">{title}</span>
                    {!isOpen && <span className="pf-fold-sum">{summary}</span>}
                </button>
                {badge}
                <Expand open={isOpen} onToggle={() => onOpen(isOpen ? "" : id)} label={title} showLabel={false} />
            </div>
            {isOpen && <div className="pf-fold-body">{children}</div>}
        </section>
    );
}

export function RaidPicker({ data, value, onChange }: { data: ProfileData; value: string[]; onChange: (next: string[]) => void }) {
    const t = useT();
    // Groups the rule set's versions; a version stays folded unless it holds a pick.
    const [shown, setShown] = useState<string>(() => data.raidGroups.find((g) => g.instances.some((i) => value.includes(i.id)))?.id || data.raidGroups[0]?.id || "");
    const group = data.raidGroups.find((g) => g.id === shown) || data.raidGroups[0];
    return (
        <div className="pf-raids">
            {data.raidGroups.length > 1 && (
                <Segment size="sm" ariaLabel={t("profile.raids.versionAria")} value={group.id} onChange={setShown}
                    options={data.raidGroups.map((g) => ({ value: g.id, label: g.label }))} />
            )}
            <div className="pf-raid-list">
                {group.instances.map((i) => {
                    const on = value.includes(i.id);
                    return (
                        <button key={i.id} type="button" className={`pf-raid${on ? " is-on" : ""}`} aria-pressed={on}
                            data-tip={instanceName(i.id, i.name)} data-tip-sub={i.status === "incomplete" ? t("profile.raids.incomplete") : undefined}
                            onClick={() => onChange(on ? value.filter((x) => x !== i.id) : [...value, i.id])}>
                            <WowIcon name={i.icon} size={20} />
                            {i.short}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/** A short list of raiders with a search — the wishes, and the same for "nicht zusammen". */
export function WishPicker({ wishes, max, classes, exclude = [], hint, onChange }: {
    wishes: RaiderRef[];
    max: number;
    classes: GameClass[];
    /** Raiders already on the other list — nobody is wished for and avoided at once. */
    exclude?: RaiderRef[];
    hint: string;
    onChange: (next: RaiderRef[]) => void;
}) {
    const t = useT();
    const [q, setQ] = useState("");
    const [hits, setHits] = useState<RaiderRef[]>([]);
    const timer = useRef<number | undefined>(undefined);

    useEffect(() => {
        window.clearTimeout(timer.current);
        if (!q.trim()) { setHits([]); return; }
        timer.current = window.setTimeout(() => {
            searchRaiders(q).then((r) => setHits(r.raiders)).catch(() => setHits([]));
        }, 250);
        return () => window.clearTimeout(timer.current);
    }, [q]);

    const chosen = new Set([...wishes, ...exclude].map((w) => w.userId));
    const colorOf = (id: string) => classColorProps(classes.find((c) => c.id === id)?.color);
    return (
        <div className="pf-wishes">
            {wishes.length > 0 && (
                <div className="pf-wish-list">
                    {wishes.map((w) => {
                        const color = colorOf(w.className);
                        return (
                            <span key={w.userId} className="pf-wish">
                                <span className={color.className} style={color.style}>{w.main || w.name || t("profile.char.unknown")}</span>
                                {w.main && w.name && <span className="pf-muted">{w.name}</span>}
                                <IconButton icon={<XIcon />} tip={t("profile.wishes.remove")} size="sm" onClick={() => onChange(wishes.filter((x) => x.userId !== w.userId))} />
                            </span>
                        );
                    })}
                </div>
            )}
            {wishes.length < max && (
                <div className="pf-search">
                    <SearchIcon />
                    <input className="inp-sm" placeholder={t("profile.wishes.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("profile.wishes.searchAria")} />
                </div>
            )}
            {hits.filter((h) => !chosen.has(h.userId)).slice(0, 6).map((h) => {
                const color = colorOf(h.className);
                return (
                    <button key={h.userId} type="button" className="pf-hit" onClick={() => { onChange([...wishes, h]); setQ(""); }}>
                        <span className={color.className} style={color.style}>{h.main || h.name}</span>
                        {h.main && <span className="pf-muted">{h.name}</span>}
                    </button>
                );
            })}
            <p className="hint">{hint}</p>
        </div>
    );
}

export function NoteField({ value, max, onSave }: { value: string; max: number; onSave: (note: string) => void }) {
    const t = useT();
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    const dirty = useMemo(() => draft.trim() !== value.trim(), [draft, value]);
    return (
        <div className="pf-note">
            <textarea
                value={draft} maxLength={max} rows={3} aria-label={t("profile.fold.note")}
                placeholder={t("profile.note.placeholder")}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => { if (dirty) onSave(draft); }}
            />
            <span className="kicker">{draft.length} / {max}</span>
        </div>
    );
}

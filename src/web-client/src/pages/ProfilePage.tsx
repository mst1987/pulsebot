import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import type { ShellContext } from "../components/Shell";
import {
    getProfile, saveProfile, removeProfileCharacter, searchRaiders,
    type ApiError, type GameClass, type GearLevel, type ProfileCharacter, type ProfileData, type ProfilePatch,
    type ProfileSpec, type RaiderProfile, type RaiderRef,
} from "../api";
import { Badge, Button, Expand, IconButton, PageHead, PartHead, RaidLoader, Segment, WowIcon, useConfirm } from "../components/ui";
import { classColorProps } from "../components/ClassSpec";
import { useToast } from "../components/Jobs";
import AddCharacterDialog, { type AddWay } from "../components/profile/AddCharacterDialog";
import { ExternalIcon, TrashIcon, XIcon, SearchIcon, EyeOffIcon } from "../components/icons";
import { formatDate } from "../lib/format";
import { specSuggestion } from "../lib/raidhelperRetirement";
import "../styles/profil.css";

// "Mein Profil" (#255): the raider's own page. Deliberately calm — the
// characters on top, the selected character's specs as the one big thing, and
// everything else (when, which raids, with whom, a note) folded in a side column
// that shows one line per part until it is opened. Every change saves itself;
// there is no form to submit.

type Fold = "days" | "raids" | "wishes" | "note" | "";

const LOG_TIP: Record<ProfileSpec["logs"]["status"], { tone?: "ok" | "mid"; label: string; tip: string }> = {
    seen: { tone: "ok", label: "laut Logs", tip: "In den Auswertungen mit genau diesem Spec belegt." },
    other: { tone: "mid", label: "nicht belegt", tip: "Der Charakter taucht in den Logs auf, aber nicht mit diesem Spec. Das ist nur ein Hinweis für die Orga, keine Sperre." },
    unknown: { label: "", tip: "" },
};

export default function ProfilePage() {
    const { user, csrfToken } = useOutletContext<ShellContext>();
    const toast = useToast();
    const ask = useConfirm();
    const [data, setData] = useState<ProfileData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [params, setParams] = useSearchParams();
    const [fold, setFold] = useState<Fold>("days");
    const [adding, setAdding] = useState<AddWay | null>(null);

    useEffect(() => {
        getProfile().then(setData).catch(setError);
    }, []);

    const profile = data?.profile || null;
    const selectedKey = params.get("char") || profile?.characters.find((c) => c.main)?.key || profile?.characters[0]?.key || "";
    const selected = profile?.characters.find((c) => c.key === selectedKey) || profile?.characters[0] || null;
    const classOf = (id: string) => data?.classes.find((c) => c.id === id);

    if (error) return <div className="empty">Profil konnte nicht geladen werden: {error.message}</div>;
    if (!data || !profile) return <RaidLoader text="Profil wird geladen" />;

    const setProfile = (next: RaiderProfile) => setData((d) => (d ? { ...d, profile: next, isNew: false } : d));

    // Optimistic: the page shows the change at once and takes the server's
    // answer (normalized) when it comes back; a failure puts the old state back.
    const patch = async (change: ProfilePatch, optimistic?: Partial<RaiderProfile>) => {
        const before = profile;
        if (optimistic) setProfile({ ...profile, ...optimistic });
        try {
            const res = await saveProfile(csrfToken, change);
            setProfile(res.profile);
        } catch (e) {
            setProfile(before);
            toast((e as ApiError).message, "err");
        }
    };

    const selectChar = (key: string) => {
        const next = new URLSearchParams(params);
        next.set("char", key);
        setParams(next, { replace: true });
    };

    const removeChar = async (c: ProfileCharacter) => {
        if (!(await ask({ title: `${c.name} entfernen?`, text: "Der Charakter verschwindet aus deinem Profil. Logs und Loot bleiben unberührt.", action: "Entfernen" }))) return;
        try {
            const res = await removeProfileCharacter(csrfToken, c.key);
            setProfile(res.profile);
        } catch (e) {
            toast((e as ApiError).message, "err");
        }
    };

    const main = profile.characters.find((c) => c.main);
    const mainClass = main ? classOf(main.className) : undefined;

    return (
        <div className="pf-page">
            <PageHead
                icon={mainClass ? mainClass.icon : "achievement_character_human_male"}
                tone="profile"
                kicker={`Discord · ${user.name} · ${profile.characters.length === 1 ? "1 Charakter" : `${profile.characters.length} Charaktere`}`}
                title="Mein Profil"
                meta={profile.updatedAt ? <Badge>geändert {formatDate(profile.updatedAt)}</Badge> : <Badge tone="accent">neu</Badge>}
                action={profile.characters.length > 0 && (
                    <Button icon="inv_misc_grouplooking" onClick={() => setAdding("log")}>Charakter hinzufügen</Button>
                )}
            />

            {profile.characters.length === 0 ? (
                <FirstCharacter onPick={setAdding} />
            ) : (
                <>
                    <div className="pf-chips" role="tablist" aria-label="Charaktere">
                        {profile.characters.map((c) => (
                            <CharChip key={c.key} character={c} cls={classOf(c.className)} active={c.key === selected?.key} onClick={() => selectChar(c.key)} />
                        ))}
                    </div>

                    <div className="pf-grid">
                        <div className="pf-col">
                            {selected && (
                                <CharacterCard
                                    character={selected}
                                    cls={classOf(selected.className)}
                                    data={data}
                                    onMain={() => patch(
                                        { characters: [{ key: selected.key, main: true }] },
                                        { characters: profile.characters.map((c) => ({ ...c, main: c.key === selected.key })) },
                                    )}
                                    onSpecs={(specs) => patch(
                                        { characters: [{ key: selected.key, specs: specs.map((s) => ({ key: s.key, gear: s.gear })) }] },
                                        { characters: profile.characters.map((c) => (c.key === selected.key ? { ...c, specs } : c)) },
                                    )}
                                    onRemove={() => removeChar(selected)}
                                />
                            )}
                            <RolesCard profile={profile} onChange={(field, value) => patch({ [field]: value }, { [field]: value })} />
                        </div>

                        <div className="pf-col pf-side">
                            <FoldPart
                                id="days" open={fold} onOpen={setFold} title="Wann ich kann"
                                summary={profile.availability.length
                                    ? data.weekdays.filter((d) => profile.availability.includes(d.id)).map((d) => d.label).join(" · ")
                                    : "nichts angegeben"}
                            >
                                <div className="pf-days">
                                    {data.weekdays.map((d) => {
                                        const on = profile.availability.includes(d.id);
                                        const next = on ? profile.availability.filter((x) => x !== d.id) : [...profile.availability, d.id];
                                        return (
                                            <button key={d.id} type="button" className={`pf-day${on ? " is-on" : ""}`} aria-pressed={on}
                                                onClick={() => patch({ availability: next }, { availability: next })}>
                                                {d.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </FoldPart>

                            <FoldPart
                                id="raids" open={fold} onOpen={setFold} title="Bevorzugte Raids"
                                summary={profile.preferredRaids.length ? `${profile.preferredRaids.length} gewählt` : "keine Vorliebe"}
                            >
                                <RaidPicker data={data} value={profile.preferredRaids} onChange={(next) => patch({ preferredRaids: next }, { preferredRaids: next })} />
                            </FoldPart>

                            <FoldPart
                                id="wishes" open={fold} onOpen={setFold} title="Gerne zusammen raiden mit"
                                summary={profile.wishes.length ? profile.wishes.map((w) => w.main || w.name).join(", ") : "niemand eingetragen"}
                                badge={<Badge icon={<EyeOffIcon />} tip="Nur die Orga sieht das" tipSub="Andere Raider sehen deine Wünsche nicht – auch nicht, ob jemand dich eingetragen hat.">nur Orga</Badge>}
                            >
                                <WishPicker
                                    wishes={profile.wishes}
                                    max={data.limits.wishes}
                                    classes={data.classes}
                                    onChange={(next) => patch({ wishes: next.map((w) => w.userId) }, { wishes: next })}
                                />
                            </FoldPart>

                            <FoldPart
                                id="note" open={fold} onOpen={setFold} title="Notiz für die Orga"
                                summary={profile.note ? profile.note : "keine Notiz"}
                            >
                                <NoteField value={profile.note} max={data.limits.note} onSave={(note) => patch({ note }, { note })} />
                            </FoldPart>
                        </div>
                    </div>
                </>
            )}

            <AddCharacterDialog
                way={adding}
                onClose={() => setAdding(null)}
                classes={data.classes}
                suggestion={specSuggestion(data.specHistory)}
                csrfToken={csrfToken}
                onAdded={(next, key) => {
                    setProfile(next);
                    selectChar(key);
                    setAdding(null);
                }}
            />
        </div>
    );
}

/** No character yet: the three ways in, nothing else. */
function FirstCharacter({ onPick }: { onPick: (way: AddWay) => void }) {
    const ways: { way: AddWay; icon: string; title: string; text: string }[] = [
        { way: "log", icon: "inv_misc_pocketwatch_01", title: "Aus den Logs", text: "Wir kennen dich vielleicht schon – Klasse und Spec kommen aus den Auswertungen." },
        { way: "armory", icon: "inv_misc_book_09", title: "Mit der Armory", text: "Name und Realm, Klasse und Level holen wir aus der Armory." },
        { way: "manual", icon: "inv_scroll_03", title: "Von Hand", text: "Name, Klasse und Specs selbst eintragen." },
    ];
    return (
        <div className="pf-first">
            <PartHead icon="achievement_character_human_male" tone="profile" title="Noch kein Charakter" crumb="Wähle, wie du anfangen willst" />
            <div className="pf-ways">
                {ways.map((w) => (
                    <button key={w.way} type="button" className="pf-way" onClick={() => onPick(w.way)}>
                        <WowIcon name={w.icon} size={32} />
                        <span className="pf-way-title">{w.title}</span>
                        <span className="pf-way-text">{w.text}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}

function CharChip({ character, cls, active, onClick }: { character: ProfileCharacter; cls?: GameClass; active: boolean; onClick: () => void }) {
    const color = classColorProps(cls?.color);
    const claimed = character.claimedBy.length > 0;
    return (
        <button type="button" role="tab" aria-selected={active} className={`pf-chip${active ? " is-active" : ""}`} onClick={onClick}>
            {cls && <WowIcon name={cls.icon} size={22} />}
            <span className={color.className} style={color.style}>{character.name}</span>
            {character.main && <span className="pf-chip-main">Main</span>}
            {claimed && (
                <span className="pf-chip-warn" data-tip="Bereits vergeben" data-tip-sub={`Auch eingetragen von: ${character.claimedBy.map((c) => c.name || "unbekannt").join(", ")}. Die Orga klärt das.`}>!</span>
            )}
        </button>
    );
}

function CharacterCard({ character, cls, data, onMain, onSpecs, onRemove }: {
    character: ProfileCharacter;
    cls?: GameClass;
    data: ProfileData;
    onMain: () => void;
    onSpecs: (specs: ProfileSpec[]) => void;
    onRemove: () => void;
}) {
    const [picking, setPicking] = useState(false);
    const missing = (cls?.specs || []).filter((s) => !character.specs.some((own) => own.key === s.key));
    const crumb = [cls?.label || character.className, character.realm, character.armory?.level ? `Stufe ${character.armory.level}` : "", character.armory?.guild || ""]
        .filter(Boolean).join(" · ");

    const addSpec = (key: string) => {
        const spec = cls?.specs.find((s) => s.key === key);
        if (!spec) return;
        onSpecs([...character.specs, {
            key, gear: "usable", label: spec.label, specId: spec.id, role: spec.role, icon: spec.icon,
            canTank: spec.canTank, canHeal: spec.canHeal, logs: { status: "unknown", reports: 0 },
        }]);
        setPicking(false);
    };

    return (
        <section className="pf-card">
            <PartHead
                icon={cls?.icon || "inv_misc_questionmark"}
                title={character.name}
                crumb={crumb}
                action={(
                    <>
                        {character.claimedBy.length > 0 && (
                            <Badge tone="mid" tip="Bereits vergeben" tipSub={`Auch eingetragen von: ${character.claimedBy.map((c) => c.name || "unbekannt").join(", ")}. Die Orga sieht das im Roster und klärt es.`}>
                                vergeben an {character.claimedBy[0].name || "anderes Konto"}
                            </Badge>
                        )}
                        {character.main
                            ? <Badge tone="accent">Main</Badge>
                            : <Button variant="ghost" size="sm" onClick={onMain}>Als Main</Button>}
                        {character.armoryUrl && (
                            <a className="ibtn sm" href={character.armoryUrl} target="_blank" rel="noreferrer" aria-label="Armory" data-tip="Armory öffnen">
                                <ExternalIcon />
                            </a>
                        )}
                        <IconButton icon={<TrashIcon />} tip="Charakter entfernen" size="sm" tone="danger" onClick={onRemove} />
                    </>
                )}
            />

            <div className="pf-specs">
                {character.specs.length === 0 && <p className="pf-muted">Noch kein Spec – füge hinzu, was du spielen kannst.</p>}
                {character.specs.map((s) => {
                    const logs = LOG_TIP[s.logs.status];
                    return (
                        <div key={s.key} className="pf-spec">
                            <WowIcon name={s.icon || "inv_misc_questionmark"} size={30} />
                            <div className="pf-spec-name">
                                <span className="pf-spec-label">{s.label}</span>
                                <span className="kicker">{data.roles[s.role as keyof ProfileData["roles"]] || ""}</span>
                            </div>
                            {logs.label && (
                                <Badge tone={logs.tone} tip={logs.label} tipSub={s.logs.reports ? `${logs.tip}\n${s.logs.reports} Auswertung${s.logs.reports === 1 ? "" : "en"} mit diesem Charakter.` : logs.tip}>
                                    {logs.label}
                                </Badge>
                            )}
                            <Segment<GearLevel>
                                size="sm"
                                ariaLabel={`Gear-Stand ${s.label}`}
                                value={s.gear}
                                options={data.gearLevels.map((g) => ({ value: g.id, label: g.label }))}
                                onChange={(gear) => onSpecs(character.specs.map((x) => (x.key === s.key ? { ...x, gear } : x)))}
                            />
                            <IconButton icon={<XIcon />} tip="Spec entfernen" size="sm" onClick={() => onSpecs(character.specs.filter((x) => x.key !== s.key))} />
                        </div>
                    );
                })}
            </div>

            {missing.length > 0 && (
                <div className="pf-addspec">
                    {picking
                        ? missing.map((s) => (
                            <Button key={s.key} variant="ghost" size="sm" icon={s.icon} onClick={() => addSpec(s.key)}>{s.label}</Button>
                        ))
                        : <Button variant="ghost" size="sm" onClick={() => setPicking(true)}>Spec hinzufügen</Button>}
                </div>
            )}
        </section>
    );
}

function RolesCard({ profile, onChange }: { profile: RaiderProfile; onChange: (field: "canOfftank" | "canHeal", value: boolean) => void }) {
    const rows: { field: "canOfftank" | "canHeal"; icon: string; label: string }[] = [
        { field: "canOfftank", icon: "ability_warrior_defensivestance", label: "Kann Offtank" },
        { field: "canHeal", icon: "spell_holy_flashheal", label: "Kann heilen" },
    ];
    return (
        <section className="pf-card pf-roles">
            {rows.map((r) => (
                <label key={r.field} className="pf-role"
                    data-tip={r.label}
                    data-tip-sub={`Vorgeschlagen aus deinen Specs: ${profile.suggested[r.field] ? "ja" : "nein"}. Du kannst es jederzeit umstellen.`}>
                    <WowIcon name={r.icon} size={26} />
                    <span className="pf-role-label">{r.label}</span>
                    <span className="switch">
                        <input type="checkbox" checked={profile[r.field]} onChange={(e) => onChange(r.field, e.target.checked)} />
                        <span className="switch-track"><span className="switch-thumb" /></span>
                    </span>
                </label>
            ))}
        </section>
    );
}

/** One foldable part of the side column: title and a one-line summary, the body only when open. */
function FoldPart({ id, open, onOpen, title, summary, badge, children }: {
    id: Exclude<Fold, "">;
    open: Fold;
    onOpen: (f: Fold) => void;
    title: string;
    summary: string;
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

function RaidPicker({ data, value, onChange }: { data: ProfileData; value: string[]; onChange: (next: string[]) => void }) {
    // Groups the rule set's versions; a version stays folded unless it holds a pick.
    const [shown, setShown] = useState<string>(() => data.raidGroups.find((g) => g.instances.some((i) => value.includes(i.id)))?.id || data.raidGroups[0]?.id || "");
    const group = data.raidGroups.find((g) => g.id === shown) || data.raidGroups[0];
    return (
        <div className="pf-raids">
            {data.raidGroups.length > 1 && (
                <Segment size="sm" ariaLabel="Spielversion" value={group.id} onChange={setShown}
                    options={data.raidGroups.map((g) => ({ value: g.id, label: g.label }))} />
            )}
            <div className="pf-raid-list">
                {group.instances.map((i) => {
                    const on = value.includes(i.id);
                    return (
                        <button key={i.id} type="button" className={`pf-raid${on ? " is-on" : ""}`} aria-pressed={on}
                            data-tip={i.name} data-tip-sub={i.status === "incomplete" ? "Infos folgen nach dem Release." : undefined}
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

function WishPicker({ wishes, max, classes, onChange }: {
    wishes: RaiderRef[];
    max: number;
    classes: GameClass[];
    onChange: (next: RaiderRef[]) => void;
}) {
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

    const chosen = new Set(wishes.map((w) => w.userId));
    const colorOf = (id: string) => classColorProps(classes.find((c) => c.id === id)?.color);
    return (
        <div className="pf-wishes">
            {wishes.length > 0 && (
                <div className="pf-wish-list">
                    {wishes.map((w) => {
                        const color = colorOf(w.className);
                        return (
                            <span key={w.userId} className="pf-wish">
                                <span className={color.className} style={color.style}>{w.main || w.name || "unbekannt"}</span>
                                {w.main && w.name && <span className="pf-muted">{w.name}</span>}
                                <IconButton icon={<XIcon />} tip="Entfernen" size="sm" onClick={() => onChange(wishes.filter((x) => x.userId !== w.userId))} />
                            </span>
                        );
                    })}
                </div>
            )}
            {wishes.length < max && (
                <div className="pf-search">
                    <SearchIcon />
                    <input className="inp-sm" placeholder="Raider suchen …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Raider suchen" />
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
            <p className="hint">Ein Wunsch, keine Garantie – die Orga berücksichtigt ihn beim Setup.</p>
        </div>
    );
}

function NoteField({ value, max, onSave }: { value: string; max: number; onSave: (note: string) => void }) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    const dirty = useMemo(() => draft.trim() !== value.trim(), [draft, value]);
    return (
        <div className="pf-note">
            <textarea
                value={draft} maxLength={max} rows={3} aria-label="Notiz für die Orga"
                placeholder="z. B. Mittwochs erst ab 19:45 online."
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => { if (dirty) onSave(draft); }}
            />
            <span className="kicker">{draft.length} / {max}</span>
        </div>
    );
}

import { useEffect, useRef, useState } from "react";
import {
    addProfileCharacter, getLogCharacters,
    type AddCharacterInput, type ApiError, type GameClass, type LogCharacterSuggestion, type RaiderProfile,
} from "../../api";
import { Badge, Button, Modal, RaidLoader, Segment, WowIcon } from "../ui";
import { classColorProps } from "../ClassSpec";
import { SearchIcon } from "../icons";
import { formatDate } from "../../lib/format";
import type { CharacterSuggestion } from "../../lib/raidhelperRetirement";

// "Charakter hinzufügen" — the three ways of #255 behind one segment:
//   log    — "Das bin ich" on a character the evaluations already know,
//   armory — name + realm, class/level/guild from the armory when it answers,
//   manual — name, class and specs by hand.
// No confirmation by the orga: a character another account already has is
// added all the same and marked, so the page says so instead of refusing.

export type AddWay = "log" | "armory" | "manual";

const WAYS: { value: AddWay; label: string; icon: string }[] = [
    { value: "log", label: "Aus Logs", icon: "inv_misc_pocketwatch_01" },
    { value: "armory", label: "Armory", icon: "inv_misc_book_09" },
    { value: "manual", label: "Von Hand", icon: "inv_scroll_03" },
];

const MATCH_LABEL: Record<string, string> = { assigned: "dir zugeordnet", name: "Name passt" };

export default function AddCharacterDialog({ way, onClose, classes, csrfToken, onAdded, suggestion = null }: {
    way: AddWay | null;
    /** #291: class, specs and name from the raider's imported Raid-Helper signups — prefills "Von Hand". */
    suggestion?: CharacterSuggestion | null;
    onClose: () => void;
    classes: GameClass[];
    csrfToken: string | null;
    onAdded: (profile: RaiderProfile, key: string) => void;
}) {
    const [tab, setTab] = useState<AddWay>(way || "log");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [needClass, setNeedClass] = useState(false);
    const [name, setName] = useState("");
    const [realm, setRealm] = useState("");
    const [className, setClassName] = useState("");
    const [specs, setSpecs] = useState<string[]>([]);

    const [suggested, setSuggested] = useState(false);
    const applySuggestion = () => {
        if (!suggestion || !classes.some((c) => c.id === suggestion.className)) return;
        setName((cur) => cur || suggestion.name);
        setClassName(suggestion.className);
        setSpecs(suggestion.specs);
        setSuggested(true);
    };

    useEffect(() => {
        if (!way) return;
        setTab(way);
        setError("");
        setNeedClass(false);
        setName("");
        setRealm("");
        setClassName("");
        setSpecs([]);
        setSuggested(false);
        if (way === "manual") applySuggestion();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [way]);

    const submit = async (input: AddCharacterInput) => {
        setBusy(true);
        setError("");
        try {
            const res = await addProfileCharacter(csrfToken, input);
            onAdded(res.profile, res.character.key);
        } catch (e) {
            const err = e as ApiError;
            if (err.code === "class_required") setNeedClass(true);
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const cls = classes.find((c) => c.id === className);
    const canSubmit = !!name.trim() && (tab === "armory" ? (!needClass || !!className) : !!className);

    return (
        <Modal
            open={!!way}
            onClose={onClose}
            icon="achievement_character_human_male"
            tone="profile"
            kicker="Mein Profil"
            title="Charakter hinzufügen"
            width={620}
            hint={error ? <span className="pf-err">{error}</span> : undefined}
            footer={tab === "log" ? <Button variant="ghost" onClick={onClose}>Schließen</Button> : (
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button
                        running={busy}
                        disabled={!canSubmit}
                        onClick={() => submit(tab === "armory"
                            ? { source: "armory", name, realm, className: className || undefined }
                            : { source: "manual", name, className, specs })}
                    >
                        {tab === "armory" ? "Verknüpfen" : "Anlegen"}
                    </Button>
                </>
            )}
        >
            <Segment<AddWay> ariaLabel="Weg" value={tab} onChange={(v) => { setTab(v); setError(""); if (v === "manual" && !className) applySuggestion(); }} options={WAYS} />

            {tab === "log" && <LogList classes={classes} busy={busy} onPick={(c) => submit({ source: "log", name: c.character })} />}

            {tab !== "log" && (
                <div className="pf-form">
                    <div className="field">
                        <label htmlFor="pf-name">Charaktername</label>
                        <input id="pf-name" value={name} maxLength={25} onChange={(e) => setName(e.target.value)} autoComplete="off" />
                        <p className="hint">Nur Buchstaben, höchstens 12 – in WoW Forever Vor- und Nachname (je 12).</p>
                    </div>
                    {tab === "armory" && (
                        <div className="field">
                            <label htmlFor="pf-realm">Realm</label>
                            <input id="pf-realm" value={realm} maxLength={32} placeholder="Thunderstrike" onChange={(e) => setRealm(e.target.value)} />
                            <p className="hint">Klasse, Stufe und Gilde kommen aus der Armory, wenn sie antwortet – sonst bleibt es beim Link.</p>
                        </div>
                    )}
                    {(tab === "manual" || needClass) && (
                        <div className="field">
                            <label>Klasse{tab === "manual" && suggested && (
                                <Badge tip="Vorschlag aus Raid-Helper" tipSub="Klasse, Specs und Name stammen aus deinen letzten Raid-Helper-Anmeldungen. Passt es nicht, einfach ändern.">aus Raid-Helper</Badge>
                            )}</label>
                            <div className="pf-classes">
                                {classes.map((c) => {
                                    const color = classColorProps(c.color);
                                    return (
                                        <button key={c.id} type="button" className={`pf-class${c.id === className ? " is-on" : ""}`}
                                            aria-pressed={c.id === className} data-tip={c.label}
                                            onClick={() => { setClassName(c.id); setSpecs([]); }}>
                                            <WowIcon name={c.icon} size={24} />
                                            <span className={color.className} style={color.style}>{c.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    {tab === "manual" && cls && (
                        <div className="field">
                            <label>Specs</label>
                            <div className="pf-classes">
                                {cls.specs.map((s) => {
                                    const on = specs.includes(s.key);
                                    return (
                                        <button key={s.key} type="button" className={`pf-class${on ? " is-on" : ""}`} aria-pressed={on}
                                            onClick={() => setSpecs(on ? specs.filter((x) => x !== s.key) : [...specs, s.key])}>
                                            <WowIcon name={s.icon} size={20} />
                                            {s.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </Modal>
    );
}

/** Suggestions from the logs, the likely ones first, filtered by a name search. */
function LogList({ classes, busy, onPick }: { classes: GameClass[]; busy: boolean; onPick: (c: LogCharacterSuggestion) => void }) {
    const [q, setQ] = useState("");
    const [list, setList] = useState<LogCharacterSuggestion[] | null>(null);
    const timer = useRef<number | undefined>(undefined);

    useEffect(() => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
            getLogCharacters(q).then((r) => setList(r.characters)).catch(() => setList([]));
        }, q ? 250 : 0);
        return () => window.clearTimeout(timer.current);
    }, [q]);

    const specLabel = (key: string) => {
        const [classId] = key.split("-");
        return classes.find((c) => c.id === classId)?.specs.find((s) => s.key === key)?.label || "";
    };

    return (
        <div className="pf-loglist">
            <div className="pf-search">
                <SearchIcon />
                <input className="inp-sm" placeholder="Name suchen …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Name suchen" />
            </div>
            {list === null && <RaidLoader compact text="Logs werden durchsucht" />}
            {list && list.length === 0 && <p className="pf-muted">Kein passender Charakter in den Logs. Versuch es über die Armory oder von Hand.</p>}
            {list && list.map((c) => {
                const cls = classes.find((x) => x.id === c.className);
                const color = classColorProps(cls?.color);
                return (
                    <div key={c.character} className="pf-logrow">
                        {cls && <WowIcon name={cls.icon} size={26} />}
                        <div className="pf-logname">
                            <span className={color.className} style={color.style}>{c.character}</span>
                            <span className="kicker">
                                {[specLabel(c.specKey) || cls?.label, c.reports ? `${c.reports} Auswertungen` : "", c.lastSeen ? `zuletzt ${formatDate(c.lastSeen)}` : ""].filter(Boolean).join(" · ")}
                            </span>
                        </div>
                        {c.match && <Badge tone="ok">{MATCH_LABEL[c.match]}</Badge>}
                        {c.claimedBy.length > 0 && (
                            <Badge tone="mid" tip="Bereits vergeben" tipSub={`Eingetragen von: ${c.claimedBy.map((x) => x.name || "unbekannt").join(", ")}. Du kannst ihn trotzdem übernehmen – die Orga klärt das.`}>
                                vergeben
                            </Badge>
                        )}
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onPick(c)}>Das bin ich</Button>
                    </div>
                );
            })}
        </div>
    );
}

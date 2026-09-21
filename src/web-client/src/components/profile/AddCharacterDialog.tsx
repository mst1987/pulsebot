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
import { classLabel, specLabel as specName } from "../../lib/wowNames";
import { useT } from "../../i18n";

// "Charakter hinzufügen" — the three ways of #255 behind one segment:
//   log    — "Das bin ich" on a character the evaluations already know,
//   armory — name + realm, class/level/guild from the armory when it answers,
//   manual — name, class and specs by hand.
// No confirmation by the orga: a character another account already has is
// added all the same and marked, so the page says so instead of refusing.

export type AddWay = "log" | "armory" | "manual";

const WAYS: { value: AddWay; key: string; icon: string }[] = [
    { value: "log", key: "profile.add.wayLog", icon: "inv_misc_pocketwatch_01" },
    { value: "armory", key: "profile.add.wayArmory", icon: "inv_misc_book_09" },
    { value: "manual", key: "profile.add.wayManual", icon: "inv_scroll_03" },
];

const MATCH_KEY: Record<string, string> = { assigned: "profile.add.matchAssigned", name: "profile.add.matchName" };

export default function AddCharacterDialog({ way, onClose, classes, csrfToken, onAdded, suggestion = null }: {
    way: AddWay | null;
    /** #291: class, specs and name from the raider's imported Raid-Helper signups — prefills "Von Hand". */
    suggestion?: CharacterSuggestion | null;
    onClose: () => void;
    classes: GameClass[];
    csrfToken: string | null;
    onAdded: (profile: RaiderProfile, key: string) => void;
}) {
    const t = useT();
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
            kicker={t("profile.title")}
            title={t("profile.add.title")}
            width={620}
            hint={error ? <span className="pf-err">{error}</span> : undefined}
            footer={tab === "log" ? <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button> : (
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button
                        running={busy}
                        disabled={!canSubmit}
                        onClick={() => submit(tab === "armory"
                            ? { source: "armory", name, realm, className: className || undefined }
                            : { source: "manual", name, className, specs })}
                    >
                        {tab === "armory" ? t("profile.add.link") : t("profile.add.create")}
                    </Button>
                </>
            )}
        >
            <Segment<AddWay> ariaLabel={t("profile.add.wayAria")} value={tab} onChange={(v) => { setTab(v); setError(""); if (v === "manual" && !className) applySuggestion(); }} options={WAYS.map((w) => ({ value: w.value, label: t(w.key), icon: w.icon }))} />

            {tab === "log" && <LogList classes={classes} busy={busy} onPick={(c) => submit({ source: "log", name: c.character })} />}

            {tab !== "log" && (
                <div className="pf-form">
                    <div className="field">
                        <label htmlFor="pf-name">{t("profile.add.name")}</label>
                        <input id="pf-name" value={name} maxLength={25} onChange={(e) => setName(e.target.value)} autoComplete="off" />
                        <p className="hint">{t("profile.add.nameHint")}</p>
                    </div>
                    {tab === "armory" && (
                        <div className="field">
                            <label htmlFor="pf-realm">{t("profile.add.realm")}</label>
                            <input id="pf-realm" value={realm} maxLength={32} placeholder="Thunderstrike" onChange={(e) => setRealm(e.target.value)} />
                            <p className="hint">{t("profile.add.realmHint")}</p>
                        </div>
                    )}
                    {(tab === "manual" || needClass) && (
                        <div className="field">
                            <label>{t("profile.add.class")}{tab === "manual" && suggested && (
                                <Badge tip={t("profile.add.fromRaidhelperTip")} tipSub={t("profile.add.fromRaidhelperSub")}>{t("profile.add.fromRaidhelper")}</Badge>
                            )}</label>
                            <div className="pf-classes">
                                {classes.map((c) => {
                                    const color = classColorProps(c.color);
                                    return (
                                        <button key={c.id} type="button" className={`pf-class${c.id === className ? " is-on" : ""}`}
                                            aria-pressed={c.id === className} data-tip={classLabel(c.id, c.label)}
                                            onClick={() => { setClassName(c.id); setSpecs([]); }}>
                                            <WowIcon name={c.icon} size={24} />
                                            <span className={color.className} style={color.style}>{classLabel(c.id, c.label)}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    {tab === "manual" && cls && (
                        <div className="field">
                            <label>{t("profile.add.specs")}</label>
                            <div className="pf-classes">
                                {cls.specs.map((s) => {
                                    const on = specs.includes(s.key);
                                    return (
                                        <button key={s.key} type="button" className={`pf-class${on ? " is-on" : ""}`} aria-pressed={on}
                                            onClick={() => setSpecs(on ? specs.filter((x) => x !== s.key) : [...specs, s.key])}>
                                            <WowIcon name={s.icon} size={20} />
                                            {specName(s.key, s.label)}
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
    const t = useT();
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
        const label = classes.find((c) => c.id === classId)?.specs.find((s) => s.key === key)?.label || "";
        return label ? specName(key, label) : "";
    };

    return (
        <div className="pf-loglist">
            <div className="pf-search">
                <SearchIcon />
                <input className="inp-sm" placeholder={t("profile.add.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("profile.add.searchAria")} />
            </div>
            {list === null && <RaidLoader compact text={t("profile.add.searching")} />}
            {list && list.length === 0 && <p className="pf-muted">{t("profile.add.noHit")}</p>}
            {list && list.map((c) => {
                const cls = classes.find((x) => x.id === c.className);
                const color = classColorProps(cls?.color);
                return (
                    <div key={c.character} className="pf-logrow">
                        {cls && <WowIcon name={cls.icon} size={26} />}
                        <div className="pf-logname">
                            <span className={color.className} style={color.style}>{c.character}</span>
                            <span className="kicker">
                                {[specLabel(c.specKey) || (cls ? classLabel(cls.id, cls.label) : ""), c.reports ? t("profile.add.reports", { count: c.reports }) : "", c.lastSeen ? t("profile.add.lastSeen", { date: formatDate(c.lastSeen) }) : ""].filter(Boolean).join(" · ")}
                            </span>
                        </div>
                        {c.match && MATCH_KEY[c.match] && <Badge tone="ok">{t(MATCH_KEY[c.match])}</Badge>}
                        {c.claimedBy.length > 0 && (
                            <Badge tone="mid" tip={t("profile.char.claimed")} tipSub={t("profile.add.claimedSub", { names: c.claimedBy.map((x) => x.name || t("profile.char.unknown")).join(", ") })}>
                                {t("profile.add.claimed")}
                            </Badge>
                        )}
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onPick(c)}>{t("profile.add.thatsMe")}</Button>
                    </div>
                );
            })}
        </div>
    );
}

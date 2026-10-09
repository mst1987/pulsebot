import { useEffect, useRef, useState } from "react";
import {
    addProfileCharacter, getLogCharacters,
    type AddCharacterInput, type ApiError, type GameClass, type LogCharacterSuggestion, type ProfileVersion, type RaiderProfile,
} from "../../api";
import { Badge, Button, Modal, RaidLoader, Segment, WowIcon } from "../ui";
import { classColorProps } from "./ClassSpec";
import { SearchIcon } from "../ui/icons";
import { formatDate } from "../../lib/format";
import type { CharacterSuggestion } from "../../lib/settings/raidhelperRetirement";
import { classLabel, specLabel as specName } from "../../lib/wow/wowNames";
import { useT } from "../../i18n";

// "Charakter hinzufügen" — the three ways of #255 behind one segment:
//   log    — "Das bin ich" on a character the evaluations already know,
//   armory — name + realm, class/level/guild from the armory when it answers,
//   manual — name, class and specs by hand.
// No confirmation by the orga: a character another account already has is
// added all the same and marked, so the page says so instead of refusing.
//
// Every character belongs to a game version (#543): with more than one version
// the dialog asks for it first (the main version preselected); the classes and
// specs are that version's, and a version with last names (WoW Forever) gets a
// first- and a last-name field.

export type AddWay = "log" | "armory" | "manual";

const WAYS: { value: AddWay; key: string; icon: string }[] = [
    { value: "log", key: "profile.add.wayLog", icon: "inv_misc_pocketwatch_01" },
    { value: "armory", key: "profile.add.wayArmory", icon: "inv_misc_book_09" },
    { value: "manual", key: "profile.add.wayManual", icon: "inv_scroll_03" },
];

const MATCH_KEY: Record<string, string> = { assigned: "profile.add.matchAssigned", name: "profile.add.matchName" };

/** Letters per name part, as utils/signup/characterNames.js checks it. */
const NAME_PART_MAX = 12;

export default function AddCharacterDialog({
    way, onClose, classes, onAdded, suggestion = null, suggestionFor, versions = [], classesByVersion, defaultVersion = "",
}: {
    way: AddWay | null;
    /** #291: class, specs and name from the raider's imported Raid-Helper signups — prefills "Von Hand". */
    suggestion?: CharacterSuggestion | null;
    /** The same per game version (#543) — wins over `suggestion`. */
    suggestionFor?: (versionId: string) => CharacterSuggestion | null;
    onClose: () => void;
    classes: GameClass[];
    onAdded: (profile: RaiderProfile, key: string) => void;
    /** The versions a character can belong to, the main version first (#543). */
    versions?: ProfileVersion[];
    classesByVersion?: Record<string, GameClass[]>;
    /** The version preselected — the main version. */
    defaultVersion?: string;
}) {
    const t = useT();
    const [addWay, setAddWay] = useState<AddWay>(way || "log");
    const firstVersion = defaultVersion || versions[0]?.id || "";
    const [version, setVersion] = useState(firstVersion);
    const [lastName, setLastName] = useState("");
    const versionInfo = versions.find((v) => v.id === version);
    const withLastName = !!versionInfo?.lastName;
    const versionClasses = (version && classesByVersion?.[version]) || classes;
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [needClass, setNeedClass] = useState(false);
    const [name, setName] = useState("");
    const [realm, setRealm] = useState("");
    const [className, setClassName] = useState("");
    const [specs, setSpecs] = useState<string[]>([]);

    const [suggested, setSuggested] = useState(false);
    const applySuggestion = (forVersion = version) => {
        const s = suggestionFor ? suggestionFor(forVersion) : suggestion;
        if (!s || !versionClasses.some((c) => c.id === s.className)) return;
        setName((cur) => cur || s.name);
        setClassName(s.className);
        setSpecs(s.specs);
        setSuggested(true);
    };

    useEffect(() => {
        if (!way) return;
        setAddWay(way);
        setError("");
        setNeedClass(false);
        setName("");
        setLastName("");
        setRealm("");
        setClassName("");
        setSpecs([]);
        setSuggested(false);
        setVersion(firstVersion);
        if (way === "manual") applySuggestion(firstVersion);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [way]);

    const submit = async (input: AddCharacterInput) => {
        setBusy(true);
        setError("");
        try {
            const res = await addProfileCharacter(version ? { ...input, versionId: version } : input);
            onAdded(res.profile, res.character.key);
        } catch (e) {
            const err = e as ApiError;
            if (err.code === "class_required") setNeedClass(true);
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const cls = versionClasses.find((c) => c.id === className);
    // Forever: "Vorname Nachname" — one space between, as the name rule wants it.
    const fullName = withLastName && lastName.trim() ? `${name.trim()} ${lastName.trim()}` : name.trim();
    const canSubmit = !!name.trim() && (addWay === "armory" ? (!needClass || !!className) : !!className);
    const pickVersion = (next: string) => {
        setVersion(next);
        setError("");
        setClassName("");
        setSpecs([]);
        setSuggested(false);
        if (!(versions.find((v) => v.id === next)?.lastName)) setLastName("");
    };

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
            footer={addWay === "log" ? <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button> : (
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button
                        running={busy}
                        disabled={!canSubmit}
                        onClick={() => submit(addWay === "armory"
                            ? { source: "armory", name: fullName, realm, className: className || undefined }
                            : { source: "manual", name: fullName, className, specs })}
                    >
                        {addWay === "armory" ? t("profile.add.link") : t("profile.add.create")}
                    </Button>
                </>
            )}
        >
            {versions.length > 1 && (
                <div className="pf-version-pick">
                    <span className="kicker">{t("profile.add.version")}</span>
                    <Segment<string>
                        ariaLabel={t("profile.add.versionAria")}
                        value={version}
                        onChange={pickVersion}
                        options={versions.map((v) => ({ value: v.id, label: v.short || v.label }))}
                    />
                </div>
            )}
            <Segment<AddWay> ariaLabel={t("profile.add.wayAria")} value={addWay} onChange={(v) => { setAddWay(v); setError(""); if (v === "manual" && !className) applySuggestion(); }} options={WAYS.map((w) => ({ value: w.value, label: t(w.key), icon: w.icon }))} />

            {addWay === "log" && <LogList classes={versionClasses} busy={busy} onPick={(c) => submit({ source: "log", name: c.character })} />}

            {addWay !== "log" && (
                <div className="pf-form">
                    {withLastName ? (
                        <div className="pf-name-pair">
                            <div className="field">
                                <label htmlFor="pf-name">{t("profile.add.firstName")}</label>
                                <input id="pf-name" value={name} maxLength={NAME_PART_MAX} onChange={(e) => setName(e.target.value.replace(/\s+/g, ""))} autoComplete="off" />
                            </div>
                            <div className="field">
                                <label htmlFor="pf-lastname">{t("profile.add.lastName")}</label>
                                <input id="pf-lastname" value={lastName} maxLength={NAME_PART_MAX} onChange={(e) => setLastName(e.target.value.replace(/\s+/g, ""))} autoComplete="off" />
                            </div>
                            <p className="hint pf-name-hint">{t("profile.add.lastNameHint", { version: versionInfo?.label || "" })}</p>
                        </div>
                    ) : (
                        <div className="field">
                            <label htmlFor="pf-name">{t("profile.add.name")}</label>
                            <input id="pf-name" value={name} maxLength={versions.length ? NAME_PART_MAX : 25} onChange={(e) => setName(e.target.value)} autoComplete="off" />
                            <p className="hint">{versions.length ? t("profile.add.nameHintOne") : t("profile.add.nameHint")}</p>
                        </div>
                    )}
                    {addWay === "armory" && (
                        <div className="field">
                            <label htmlFor="pf-realm">{t("profile.add.realm")}</label>
                            <input id="pf-realm" value={realm} maxLength={32} placeholder="Thunderstrike" onChange={(e) => setRealm(e.target.value)} />
                            <p className="hint">{t("profile.add.realmHint")}</p>
                        </div>
                    )}
                    {(addWay === "manual" || needClass) && (
                        <div className="field">
                            <label>{t("profile.add.class")}{addWay === "manual" && suggested && (
                                <Badge tip={t("profile.add.fromRaidhelperTip")} tipSub={t("profile.add.fromRaidhelperSub")}>{t("profile.add.fromRaidhelper")}</Badge>
                            )}</label>
                            <div className="pf-classes">
                                {versionClasses.map((c) => {
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
                    {addWay === "manual" && cls && (
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

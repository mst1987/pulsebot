import { useEffect, useState } from "react";
import type { ApiError, CharacterEditInput, GameClass, LogCharacterSuggestion, ProfileCharacter } from "../../api";
import { Button, Modal, Segment, WowIcon } from "../ui";
import { classColorProps } from "./ClassSpec";
import { LogList } from "./AddCharacterDialog";
import { classLabel, specLabel as specName } from "../../lib/wow/wowNames";
import { useT } from "../../i18n";
import { SaveIcon } from "../ui/icons";

// "Charakter bearbeiten" — who a character is. The raider's own (Mein Profil)
// and the orga's (Alle Charaktere) use the same dialog; only `onSave` and
// `loadLog` differ. Two ways, mostly to set a wrong name right ("Gentle" for a
// druid, a typo):
//   log    — pick the character from the logs: name and class come from there,
//            the names that look like a typo of this one first;
//   manual — name, realm, class and specs by hand.
// A new name takes the rosters, signups, guild bank requests and attendance
// entries along (services/characters/characterEdit.js), which the dialog says
// before it is saved. By hand only what changed is sent; another class starts
// its specs anew, the gear of a spec that stays is kept by the server.

type Way = "log" | "manual";

/** Letters per name part, as utils/signup/characterNames.js checks it. */
const NAME_PART_MAX = 12;

export default function EditCharacterDialog({ character, classes, lastName = false, owner = "", loadLog, onSave, onClose }: {
    /** The character being edited; null = closed. */
    character: ProfileCharacter | null;
    /** The classes of the character's game version. */
    classes: GameClass[];
    /** The version names characters "Vorname Nachname" (WoW Forever). */
    lastName?: boolean;
    /** Whose character it is — the orga's list says so in the head. */
    owner?: string;
    /** The logged characters to pick from, the typos of this one first. */
    loadLog: (q: string) => Promise<{ characters: LogCharacterSuggestion[] }>;
    onSave: (input: CharacterEditInput) => Promise<void>;
    onClose: () => void;
}) {
    const t = useT();
    const [way, setWay] = useState<Way>("log");
    const [first, setFirst] = useState("");
    const [last, setLast] = useState("");
    const [realm, setRealm] = useState("");
    const [className, setClassName] = useState("");
    const [specs, setSpecs] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!character) return;
        const [f, ...rest] = character.name.split(" ");
        setWay("log");
        setFirst(lastName ? f : character.name);
        setLast(lastName ? rest.join(" ") : "");
        setRealm(character.realm || "");
        setClassName(character.className);
        setSpecs(character.specs.map((s) => s.key));
        setError("");
        setBusy(false);
    }, [character, lastName]);

    if (!character) return null;

    const name = lastName && last.trim() ? `${first.trim()} ${last.trim()}` : first.trim();
    const cls = classes.find((c) => c.id === className);
    const nameChanged = name !== character.name;
    const sameSpecs = specs.length === character.specs.length && specs.every((s, i) => s === character.specs[i]?.key);
    const input: CharacterEditInput = {
        ...(nameChanged ? { name } : {}),
        ...(realm.trim() !== (character.realm || "") ? { realm: realm.trim() } : {}),
        ...(className !== character.className ? { className } : {}),
        ...(!sameSpecs || className !== character.className ? { specs } : {}),
    };
    const changed = Object.keys(input).length > 0;

    const save = async (what: CharacterEditInput) => {
        setBusy(true);
        setError("");
        try {
            await onSave(what);
        } catch (e) {
            setError((e as ApiError).message);
            setBusy(false);
        }
    };

    const hint = error
        ? <span className="pf-err">{error}</span>
        : way === "log" || nameChanged ? <span className="hint">{t("profile.edit.renameHint", { from: character.name })}</span> : undefined;

    return (
        <Modal
            open
            onClose={onClose}
            icon={classes.find((c) => c.id === character.className)?.icon || "profile"}
            tone="profile"
            kicker={owner ? t("profile.edit.kickerOf", { owner }) : t("profile.title")}
            title={t("profile.edit.title", { name: character.name })}
            width={620}
            hint={hint}
            footer={way === "log" ? <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button> : (
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button variant="go" icon={<SaveIcon />} running={busy} disabled={!changed || !first.trim() || !className} onClick={() => save(input)}>{t("profile.edit.save")}</Button>
                </>
            )}
        >
            <Segment<Way>
                ariaLabel={t("profile.edit.wayAria")}
                value={way}
                onChange={(v) => { setWay(v); setError(""); }}
                options={[
                    { value: "log", label: t("profile.edit.wayLog"), icon: "logs" },
                    { value: "manual", label: t("profile.edit.wayManual"), icon: "edit" },
                ]}
            />

            {way === "log" && (
                <>
                    <p className="hint pf-edit-hint">{t("profile.edit.logHint")}</p>
                    <LogList classes={classes} busy={busy} load={loadLog} pickLabel={t("profile.edit.pick")} emptyText={t("profile.edit.noHit")} onPick={(c) => save({ fromLog: c.character })} />
                </>
            )}

            {way === "manual" && (
                <div className="pf-form">
                    {lastName ? (
                        <div className="pf-name-pair">
                            <div className="field">
                                <label htmlFor="pf-edit-name">{t("profile.add.firstName")}</label>
                                <input id="pf-edit-name" value={first} maxLength={NAME_PART_MAX} onChange={(e) => setFirst(e.target.value.replace(/\s+/g, ""))} autoComplete="off" />
                            </div>
                            <div className="field">
                                <label htmlFor="pf-edit-lastname">{t("profile.add.lastName")}</label>
                                <input id="pf-edit-lastname" value={last} maxLength={NAME_PART_MAX} onChange={(e) => setLast(e.target.value.replace(/\s+/g, ""))} autoComplete="off" />
                            </div>
                        </div>
                    ) : (
                        <div className="field">
                            <label htmlFor="pf-edit-name">{t("profile.add.name")}</label>
                            <input id="pf-edit-name" value={first} maxLength={25} onChange={(e) => setFirst(e.target.value)} autoComplete="off" />
                            <p className="hint">{t("profile.edit.nameHint")}</p>
                        </div>
                    )}
                    <div className="field">
                        <label htmlFor="pf-edit-realm">{t("profile.add.realm")}</label>
                        <input id="pf-edit-realm" value={realm} maxLength={32} placeholder="Thunderstrike" onChange={(e) => setRealm(e.target.value)} />
                    </div>
                    <div className="field">
                        <label>{t("profile.add.class")}</label>
                        <div className="pf-classes" role="group" aria-label={t("profile.add.class")}>
                            {classes.map((c) => {
                                const color = classColorProps(c.color);
                                return (
                                    <button key={c.id} type="button" className={`pf-class${c.id === className ? " is-on" : ""}`}
                                        aria-pressed={c.id === className} data-tip={classLabel(c.id, c.label)}
                                        onClick={() => { if (c.id !== className) { setClassName(c.id); setSpecs([]); } }}>
                                        <WowIcon name={c.icon} size={24} />
                                        <span className={color.className} style={color.style}>{classLabel(c.id, c.label)}</span>
                                    </button>
                                );
                            })}
                        </div>
                        {className !== character.className && <p className="hint">{t("profile.edit.classHint")}</p>}
                    </div>
                    {cls && (
                        <div className="field">
                            <label>{t("profile.add.specs")}</label>
                            <div className="pf-classes" role="group" aria-label={t("profile.add.specs")}>
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

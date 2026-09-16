import type { SignupClass, SignupProfile } from "../api";
import { IconButton, WowIcon } from "./ui";
import { classColorProps } from "./ClassSpec";
import { ChevronDownIcon, XIcon } from "./icons";
import { GEAR_LABEL } from "../lib/signups";
import {
    MAX_CHARACTERS, addPick, canAddPick, movePick, removePick, setPickCharacter, setPickSpec,
    type CharacterPick,
} from "../lib/signupPicks";

// The characters of a signup (#293): one line per character · spec, numbered —
// the first is the choice, the others "kann auch mit" — with arrows to reorder
// and a way to add up to three. The orga's setup takes exactly one of them.

export default function SignupCharacterPicks({ profile, classes, picks, onChange, disabled = false }: {
    profile: SignupProfile;
    classes: SignupClass[];
    picks: CharacterPick[];
    onChange: (picks: CharacterPick[]) => void;
    disabled?: boolean;
}) {
    return (
        <div className="field">
            <label>Charaktere</label>
            <ol className="an-picks">
                {picks.map((p, i) => {
                    const character = profile.characters.find((c) => c.key === p.characterKey);
                    const cls = classes.find((c) => c.id === character?.className);
                    const spec = character?.specs.find((s) => s.key === p.spec);
                    return (
                        <li key={`${p.characterKey}-${i}`} className="an-pickrow">
                            <span
                                className={`an-rank${i === 0 ? " an-rank-first" : ""}`}
                                data-tip={i === 0 ? "1. Wahl" : "Kann auch mit"}
                                data-tip-sub={i === 0 ? "Mit diesem Charakter kommst du am liebsten." : "Nimmt die Orga, wenn es für den Raid besser passt."}
                            >
                                {i + 1}
                            </span>
                            <div className="an-pick">
                                {cls && <WowIcon name={cls.icon} size={22} />}
                                <select aria-label={`Charakter ${i + 1}`} value={p.characterKey} disabled={disabled} onChange={(e) => onChange(setPickCharacter(profile, picks, i, e.target.value))} {...classColorProps(cls?.color)}>
                                    {profile.characters.map((c) => <option key={c.key} value={c.key}>{c.name}{c.main ? " (Main)" : ""}</option>)}
                                </select>
                            </div>
                            <div className="an-pick">
                                {spec && <WowIcon name={spec.icon} size={22} />}
                                <select aria-label={`Spec ${i + 1}`} value={p.spec} disabled={disabled || !character?.specs.length} onChange={(e) => onChange(setPickSpec(picks, i, e.target.value))}>
                                    {!character?.specs.length && <option value="">kein Spec im Profil</option>}
                                    {character?.specs.map((s) => <option key={s.key} value={s.key}>{s.label} · {GEAR_LABEL[s.gear] || s.gear}</option>)}
                                </select>
                            </div>
                            {picks.length > 1 && (
                                <span className="an-pick-tools">
                                    <IconButton size="sm" className="an-up" icon={<ChevronDownIcon />} tip="Nach oben" disabled={disabled || i === 0} onClick={() => onChange(movePick(picks, i, -1))} />
                                    <IconButton size="sm" icon={<ChevronDownIcon />} tip="Nach unten" disabled={disabled || i === picks.length - 1} onClick={() => onChange(movePick(picks, i, 1))} />
                                    <IconButton size="sm" icon={<XIcon />} tip="Entfernen" disabled={disabled} onClick={() => onChange(removePick(picks, i))} />
                                </span>
                            )}
                        </li>
                    );
                })}
            </ol>
            {canAddPick(profile, picks) && !disabled && (
                <button type="button" className="an-add" onClick={() => onChange(addPick(profile, picks))}>
                    + Kann auch mit … <span className="an-opt">(bis {MAX_CHARACTERS})</span>
                </button>
            )}
            {picks.length > 1 && <div className="hint">1 = deine Wahl, die weiteren „kann auch mit“. Die Orga stellt dich mit genau einem auf.</div>}
        </div>
    );
}

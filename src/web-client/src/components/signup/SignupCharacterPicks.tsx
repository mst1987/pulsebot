import type { SignupClass, SignupProfile, SignupStatus } from "../../api";
import { IconButton, WowIcon } from "../ui";
import { classColorProps } from "../ClassSpec";
import { ChevronDownIcon, XIcon } from "../icons";
import { CHARACTER_STATUS_ORDER, GEAR_LABEL, SIGNUP_STATUS } from "../../lib/signups";
import {
    MAX_CHARACTERS, addPick, canAddPick, movePick, removePick, setPickCharacter, setPickSpec, setPickStatus,
    type CharacterPick,
} from "../../lib/signupPicks";
import { specLabel } from "../../lib/wowNames";
import { useT } from "../../i18n";

// The characters of a signup (#293): one line per character · spec, numbered —
// the first is the choice, the others "kann auch mit" — with arrows to reorder
// and a way to add up to three. The orga's setup takes exactly one of them.
//
// With more than one character every line also carries its own status (#320) —
// a small coloured dot with a compact select, so "Spät" on the first character
// leaves the others "Dabei", exactly as the Discord buttons behave since #302.
// Deliberately not a second block of switches: the dialog's big status segment
// stays the one that sets them all. `statuses={false}` (the default, and what
// the bulk dialog wants) leaves the dots out entirely.

export default function SignupCharacterPicks({ profile, classes, picks, onChange, disabled = false, statuses = false, allowedStatuses = [] }: {
    profile: SignupProfile;
    classes: SignupClass[];
    picks: CharacterPick[];
    onChange: (picks: CharacterPick[]) => void;
    disabled?: boolean;
    /** Offer a status per character — only where one single signup is edited (#320). */
    statuses?: boolean;
    /** What the event's phase still allows; a character may always keep the status it has. */
    allowedStatuses?: SignupStatus[];
}) {
    const t = useT();
    const showStatus = statuses && !disabled && picks.length > 1;
    return (
        <div className="field">
            <label>{t("signups.picks.characters")}</label>
            <ol className="an-picks">
                {picks.map((p, i) => {
                    const character = profile.characters.find((c) => c.key === p.characterKey);
                    const cls = classes.find((c) => c.id === character?.className);
                    const spec = character?.specs.find((s) => s.key === p.spec);
                    return (
                        <li key={`${p.characterKey}-${i}`} className="an-pickrow">
                            <span
                                className={`an-rank${i === 0 ? " an-rank-first" : ""}`}
                                data-tip={i === 0 ? t("signups.picks.firstChoice") : t("signups.picks.canAlsoWith")}
                                data-tip-sub={i === 0 ? t("signups.picks.firstChoiceSub") : t("signups.picks.canAlsoWithSub")}
                            >
                                {i + 1}
                            </span>
                            <div className="an-pick">
                                {cls && <WowIcon name={cls.icon} size={22} />}
                                <select aria-label={t("signups.picks.characterAria", { n: i + 1 })} value={p.characterKey} disabled={disabled} onChange={(e) => onChange(setPickCharacter(profile, picks, i, e.target.value))} {...classColorProps(cls?.color)}>
                                    {profile.characters.map((c) => <option key={c.key} value={c.key}>{c.name}{c.main ? t("signups.picks.main") : ""}</option>)}
                                </select>
                            </div>
                            <div className="an-pick">
                                {spec && <WowIcon name={spec.icon} size={22} />}
                                <select aria-label={t("signups.picks.specAria", { n: i + 1 })} value={p.spec} disabled={disabled || !character?.specs.length} onChange={(e) => onChange(setPickSpec(picks, i, e.target.value))}>
                                    {!character?.specs.length && <option value="">{t("signups.picks.noSpec")}</option>}
                                    {character?.specs.map((s) => <option key={s.key} value={s.key}>{specLabel(s.key, s.label)} · {GEAR_LABEL[s.gear] || s.gear}</option>)}
                                </select>
                            </div>
                            {showStatus && (
                                <div
                                    className="an-pick an-pick-status"
                                    data-tip={t("signups.picks.statusTip")}
                                    data-tip-sub={t("signups.picks.statusTipSub")}
                                >
                                    <i className="an-dot" style={{ background: SIGNUP_STATUS[p.status || "signed"].color }} />
                                    <select
                                        aria-label={t("signups.picks.statusAria", { n: i + 1 })}
                                        value={p.status || "signed"}
                                        onChange={(e) => onChange(setPickStatus(picks, i, e.target.value as SignupStatus))}
                                    >
                                        {CHARACTER_STATUS_ORDER.filter((s) => allowedStatuses.includes(s) || s === p.status)
                                            .map((s) => <option key={s} value={s}>{SIGNUP_STATUS[s].label}</option>)}
                                    </select>
                                </div>
                            )}
                            {picks.length > 1 && (
                                <span className="an-pick-tools">
                                    <IconButton size="sm" className="an-up" icon={<ChevronDownIcon />} tip={t("signups.picks.moveUp")} disabled={disabled || i === 0} onClick={() => onChange(movePick(picks, i, -1))} />
                                    <IconButton size="sm" icon={<ChevronDownIcon />} tip={t("signups.picks.moveDown")} disabled={disabled || i === picks.length - 1} onClick={() => onChange(movePick(picks, i, 1))} />
                                    <IconButton size="sm" icon={<XIcon />} tip={t("signups.picks.remove")} disabled={disabled} onClick={() => onChange(removePick(picks, i))} />
                                </span>
                            )}
                        </li>
                    );
                })}
            </ol>
            {canAddPick(profile, picks) && !disabled && (
                <button type="button" className="an-add" onClick={() => onChange(addPick(profile, picks))}>
                    {t("signups.picks.add")} <span className="an-opt">{t("signups.picks.upTo", { max: MAX_CHARACTERS })}</span>
                </button>
            )}
            {picks.length > 1 && (
                <div className="hint">
                    {t("signups.picks.hint")}
                    {showStatus ? t("signups.picks.hintStatus") : ""}
                </div>
            )}
        </div>
    );
}

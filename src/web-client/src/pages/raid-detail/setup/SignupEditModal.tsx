// "Anmeldung bearbeiten" (#521): the orga changes one raider's signup right in
// the setup editor — status, character, spec. Compact on purpose: the status as
// a segment, the characters as chips (only when there is a choice), the specs of
// the class as buttons, a spec the profile lacks dashed and named in one line.
// Deadline and profile do not bind the orga; the server saves it through the
// signup service, so message, talk overview and log follow. Mounted only while
// open, so every opening reads the signup as it is stored now.
import { useEffect, useState } from "react";
import { getSetupSignup, type ApiError, type SetupPerson, type SetupSignupEdit, type SetupSignupInput } from "../../../api";
import { useApi } from "../../../hooks/useApi";
import { initialPick, optionOf, outsideProfile, pickChanged, pickCharacter, signupEditInput, type SignupEditPick } from "../../../lib/setupSignupEdit";
import { SIGNUP_STATUS } from "../../../lib/signups";
import { wowIconUrl } from "../../../lib/wowIcon";
import { roleLabel, specLabel } from "../../../lib/wowNames";
import { useT } from "../../../i18n";
import { Button } from "../../../components/ui/Button";
import Field from "../../../components/ui/Field";
import { Modal } from "../../../components/ui/Modal";
import Segment from "../../../components/ui/Segment";
import WowIcon from "../../../components/ui/WowIcon";
import RaidLoader from "../../../components/ui/RaidLoader";
import { classColorProps } from "../../../components/character/ClassSpec";
import SpecTile from "../SpecTile";

function CharacterChips({ data, pick, onPick }: { data: SetupSignupEdit; pick: SignupEditPick; onPick: (key: string) => void }) {
    const t = useT();
    const current = optionOf(data, pick);
    return (
        <Field label={t("setup.signupEdit.character")}>
            <div className="se-edit-row" role="radiogroup" aria-label={t("setup.signupEdit.character")}>
                {data.options.map((o) => {
                    const on = o.key === current?.key;
                    const color = classColorProps(o.classColor);
                    return (
                        <button key={o.key} type="button" role="radio" aria-checked={on} className={`se-edit-opt${on ? " is-on" : ""}`} data-tip={o.classLabel} onClick={() => onPick(o.key)}>
                            {o.classIcon && <WowIcon name={o.classIcon} size={18} />}
                            <span className={color.className} style={color.style}>{o.character}</span>
                        </button>
                    );
                })}
            </div>
        </Field>
    );
}

function SpecChoice({ data, start, pick, onSpec }: { data: SetupSignupEdit; start: SignupEditPick; pick: SignupEditPick; onSpec: (key: string) => void }) {
    const t = useT();
    const option = optionOf(data, pick);
    if (!option) return null;
    const chosen = option.specs.find((s) => s.key === pick.spec);
    // named once the orga picks such a spec — the one the raider signed up with needs no sentence (a raider without a profile has none in it)
    const hint = chosen && outsideProfile(data, pick) && pick.spec !== start.spec
        ? t("setup.signupEdit.notInProfileHint", { spec: specLabel(chosen.key, chosen.label), character: option.character })
        : undefined;
    return (
        <Field label={t("setup.signupEdit.spec")} hint={hint}>
            <div className="se-edit-row" role="radiogroup" aria-label={t("setup.signupEdit.spec")}>
                {option.specs.map((s) => {
                    const on = s.key === pick.spec;
                    const name = specLabel(s.key, s.label);
                    return (
                        <button
                            key={s.key} type="button" role="radio" aria-checked={on}
                            className={`se-edit-opt${on ? " is-on" : ""}${s.inProfile ? "" : " se-edit-off"}`}
                            data-tip={name} data-tip-sub={s.inProfile ? roleLabel(s.role) : `${roleLabel(s.role)} · ${t("setup.signupEdit.notInProfile")}`}
                            onClick={() => onSpec(s.key)}
                        >
                            <WowIcon name={s.icon || "inv_misc_questionmark"} size={18} />
                            <span>{name}</span>
                        </button>
                    );
                })}
            </div>
        </Field>
    );
}

/** The dialog for one raider of the setup (group, bench or "Angemeldet"). */
export function SignupEditModal({ eventId, person, onClose, onSave }: {
    eventId: string;
    person: SetupPerson;
    onClose: () => void;
    onSave: (input: SetupSignupInput) => Promise<void>;
}) {
    const t = useT();
    const signup = useApi(() => getSetupSignup(eventId, person.userId), [eventId, person.userId]);
    const data = signup.data;
    const [start, setStart] = useState<SignupEditPick | null>(null);
    const [pick, setPick] = useState<SignupEditPick | null>(null);
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState("");
    useEffect(() => {
        if (!data) return;
        const first = initialPick(data, person.character);
        setStart(first);
        setPick(first);
    }, [data, person.character]);

    const save = async () => {
        if (!start || !pick) return;
        setSaving(true);
        setFailed("");
        try {
            await onSave(signupEditInput(person.userId, start, pick));
        } catch (e) {
            setFailed((e as ApiError).message || t("setup.signupEdit.failed"));
            setSaving(false);
        }
    };
    const absent = pick?.status === "absence";
    return (
        <Modal
            open onClose={onClose} tone="raids" width={500}
            icon={<SpecTile iconUrl={person.specIcon ? wowIconUrl(person.specIcon, 36) : undefined} classColor={person.classColor} />}
            kicker={t("setup.signupEdit.kicker")} title={person.character}
            hint={t("setup.signupEdit.hint")}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button running={saving} disabled={!start || !pick || !pickChanged(start, pick)} onClick={save}>{t("common.save")}</Button>
                </>
            )}
        >
            {signup.error && <p className="field-error">{t("setup.signupEdit.loadFailed", { message: signup.error.message })}</p>}
            {!signup.error && (!data || !pick) && <RaidLoader text={t("setup.signupEdit.loading")} compact />}
            {data && pick && (
                <div className="se-edit">
                    <Field label={t("setup.signupEdit.status")}>
                        <Segment
                            size="sm" ariaLabel={t("setup.signupEdit.status")} value={pick.status}
                            options={data.statuses.map((s) => ({ value: s, label: SIGNUP_STATUS[s].label, tip: SIGNUP_STATUS[s].tip }))}
                            onChange={(status) => setPick({ ...pick, status })}
                        />
                    </Field>
                    {absent && <p className="se-note">{t("setup.signupEdit.absenceHint")}</p>}
                    {!absent && data.options.length > 1 && <CharacterChips data={data} pick={pick} onPick={(key) => setPick(pickCharacter(data, pick, key))} />}
                    {!absent && start && <SpecChoice data={data} start={start} pick={pick} onSpec={(spec) => setPick({ ...pick, spec })} />}
                    {failed && <p className="field-error" role="alert">{failed}</p>}
                </div>
            )}
        </Modal>
    );
}

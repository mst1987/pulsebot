import type { CSSProperties } from "react";
import type { SignupClass } from "../../api";
import { WowIcon } from "../ui";
import { useT } from "../../i18n";
import type { NewCharacter } from "../../lib/signups/newCharacter";

// A signup without a character of the raid's version (#907): class -> spec ->
// name, the same three steps the bot asks. The server adds the character to the
// profile of the raid's version (source "manual") and signs it up in one go.
// Each step shows once the one before it is picked, so the dialog stays short.

export default function NewCharacterPick({ classes, value, onChange, version = "", disabled = false }: {
    /** The raid version's classes, each with its `specs` (classesByVersion). */
    classes: SignupClass[];
    value: NewCharacter;
    onChange: (next: NewCharacter) => void;
    /** The raid's version label, when the profile has characters of another one. */
    version?: string;
    disabled?: boolean;
}) {
    const t = useT();
    const cls = classes.find((c) => c.id === value.classId) || null;
    const specs = cls?.specs || [];

    return (
        <div className="an-newchar" data-new-character>
            <p className="an-note">
                {version ? t("signups.newChar.introVersion", { version }) : t("signups.newChar.intro")}
            </p>
            <div className="field">
                <label id="an-new-class">{t("signups.newChar.class")}</label>
                <div className="an-also" role="radiogroup" aria-labelledby="an-new-class">
                    {classes.map((c) => {
                        const on = c.id === value.classId;
                        return (
                            <button
                                key={c.id} type="button" role="radio" aria-checked={on} disabled={disabled}
                                className={`an-chip an-cls${on ? " is-on" : ""}`}
                                style={{ "--an-cls": c.color } as CSSProperties}
                                onClick={() => onChange({ ...value, classId: c.id, spec: on ? value.spec : "" })}
                            >
                                <WowIcon name={c.icon} size={20} />
                                {c.label}
                            </button>
                        );
                    })}
                </div>
            </div>
            {cls && (
                <div className="field">
                    <label id="an-new-spec">{t("signups.newChar.spec")}</label>
                    <div className="an-also" role="radiogroup" aria-labelledby="an-new-spec">
                        {specs.map((s) => {
                            const on = s.key === value.spec;
                            return (
                                <button
                                    key={s.key} type="button" role="radio" aria-checked={on} disabled={disabled}
                                    className={`an-chip${on ? " is-on" : ""}`}
                                    onClick={() => onChange({ ...value, spec: s.key })}
                                >
                                    <WowIcon name={s.icon} size={20} />
                                    {s.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
            {cls && value.spec && (
                <div className="field">
                    <label htmlFor="an-new-name">{t("signups.newChar.name")}</label>
                    <input
                        id="an-new-name" type="text" maxLength={12} value={value.name} disabled={disabled}
                        autoComplete="off" spellCheck={false}
                        onChange={(e) => onChange({ ...value, name: e.target.value })}
                    />
                    <div className="hint">{t("signups.newChar.nameHint")}</div>
                </div>
            )}
        </div>
    );
}

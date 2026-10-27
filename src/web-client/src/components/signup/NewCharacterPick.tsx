import type { KeyboardEvent } from "react";
import type { SignupClass } from "../../api";
import { rovingIndex } from "../../lib/signups/pugMembers";
import { WowIcon } from "../ui";
import { classColorProps } from "../character/ClassSpec";
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
    const classIndex = classes.findIndex((c) => c.id === value.classId);
    const specIndex = specs.findIndex((s) => s.key === value.spec);

    // One tab stop per group (the chosen chip, else the first), the arrows pick
    // the neighbour - the keyboard of a native radio group (#907).
    const roving = (count: number, current: number, pick: (i: number) => void) => (e: KeyboardEvent<HTMLButtonElement>) => {
        const next = rovingIndex(Math.max(current, 0), count, e.key);
        if (next === null) return;
        e.preventDefault();
        pick(next);
        const group = e.currentTarget.parentElement;
        group?.querySelectorAll<HTMLButtonElement>("[role=radio]")[next]?.focus();
    };
    const pickClass = (i: number) => {
        const c = classes[i];
        if (c) onChange({ ...value, classId: c.id, spec: c.id === value.classId ? value.spec : "" });
    };
    const pickSpec = (i: number) => {
        const s = specs[i];
        if (s) onChange({ ...value, spec: s.key });
    };

    return (
        <div className="an-newchar" data-new-character>
            <p className="an-note">
                {version ? t("signups.newChar.introVersion", { version }) : t("signups.newChar.intro")}
            </p>
            <div className="field">
                <label id="an-new-class">{t("signups.newChar.class")}</label>
                <div className="an-also" role="radiogroup" aria-labelledby="an-new-class">
                    {classes.map((c, i) => {
                        const on = c.id === value.classId;
                        // the class colour through --cc, darkened on the light theme (white priest, yellow rogue)
                        const cc = classColorProps(c.color);
                        return (
                            <button
                                key={c.id} type="button" role="radio" aria-checked={on} disabled={disabled}
                                tabIndex={i === Math.max(classIndex, 0) ? 0 : -1}
                                className={`an-chip an-cls${on ? " is-on" : ""}${cc.className ? ` ${cc.className}` : ""}`}
                                style={cc.style} data-class={c.id}
                                onClick={() => pickClass(i)}
                                onKeyDown={roving(classes.length, classIndex, pickClass)}
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
                        {specs.map((s, i) => {
                            const on = s.key === value.spec;
                            return (
                                <button
                                    key={s.key} type="button" role="radio" aria-checked={on} disabled={disabled}
                                    tabIndex={i === Math.max(specIndex, 0) ? 0 : -1}
                                    className={`an-chip${on ? " is-on" : ""}`}
                                    onClick={() => pickSpec(i)}
                                    onKeyDown={roving(specs.length, specIndex, pickSpec)}
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

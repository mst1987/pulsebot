// "Anmeldung bearbeiten" in the setup editor (#521): the orga changes a
// raider's status, character and spec. The rules the dialog applies before the
// server checks them again (src/services/setup/setupSignup.js) — pure, tested
// beside it.
import type { SetupSignupEdit, SetupSignupInput, SetupSignupOption, SignupStatus } from "../api";

/** What the dialog holds: the status, the chosen character (by key) and its spec. */
export type SignupEditPick = { status: SignupStatus; character: string; spec: string };

const keyOf = (name: string) => String(name || "").trim().toLowerCase();

/** The character the setup shows (`shown`), else the signup's first — as an option of the dialog. */
export function shownOption(data: SetupSignupEdit, shown: string): SetupSignupOption | undefined {
    const wanted = keyOf(shown);
    return data.options.find((o) => o.key === wanted)
        || data.options.find((o) => o.key === keyOf(data.characters[0]?.character || ""))
        || data.options[0];
}

/** The dialog's start: the signup as it stands, on the character the setup shows. */
export function initialPick(data: SetupSignupEdit, shown: string): SignupEditPick {
    const option = shownOption(data, shown);
    const entry = option ? data.characters.find((c) => keyOf(c.character) === option.key) : undefined;
    const spec = entry?.spec || option?.specs.find((s) => s.inProfile)?.key || option?.specs[0]?.key || "";
    return { status: data.status, character: option?.character || shown, spec };
}

/** Another character: its signed spec, else the spec of the same role, else its first profile spec. */
export function pickCharacter(data: SetupSignupEdit, pick: SignupEditPick, key: string): SignupEditPick {
    const option = data.options.find((o) => o.key === key);
    if (!option) return pick;
    const entry = data.characters.find((c) => keyOf(c.character) === option.key);
    const role = data.options.flatMap((o) => o.specs).find((s) => s.key === pick.spec)?.role;
    const spec = entry?.spec
        || option.specs.find((s) => s.inProfile && s.role === role)?.key
        || option.specs.find((s) => s.inProfile)?.key
        || option.specs[0]?.key
        || "";
    return { ...pick, character: option.character, spec };
}

/** The option of the picked character. */
export function optionOf(data: SetupSignupEdit, pick: SignupEditPick): SetupSignupOption | undefined {
    return data.options.find((o) => o.key === keyOf(pick.character));
}

/** Whether the picked spec is one the raider's profile does not list — the dialog says so. */
export function outsideProfile(data: SetupSignupEdit, pick: SignupEditPick): boolean {
    const spec = optionOf(data, pick)?.specs.find((s) => s.key === pick.spec);
    return !!spec && !spec.inProfile;
}

/** Whether anything differs from where the dialog started. */
export function pickChanged(start: SignupEditPick, pick: SignupEditPick): boolean {
    return start.status !== pick.status || keyOf(start.character) !== keyOf(pick.character) || start.spec !== pick.spec;
}

/** The request: `from` is the character the setup shows — the one this pick replaces; an absence sends no character. */
export function signupEditInput(userId: string, start: SignupEditPick, pick: SignupEditPick): SetupSignupInput {
    if (pick.status === "absence") return { userId, status: pick.status, from: start.character };
    return { userId, status: pick.status, from: start.character, character: pick.character, spec: pick.spec };
}

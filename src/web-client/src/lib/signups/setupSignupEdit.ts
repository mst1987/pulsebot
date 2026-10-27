// "Anmeldung bearbeiten" in the setup editor (#521): the orga changes a
// raider's status, character and spec. The rules the dialog applies before the
// server checks them again (src/services/setup/setupSignup.js) — pure, tested
// beside it.
import type { SetupSignupClass, SetupSignupEdit, SetupSignupInput, SetupSignupOption, SignupStatus } from "../../api";

/**
 * What the dialog holds: the status, the chosen character (by key) and its spec.
 * `other`: the orga names another character by hand ("Anderer Charakter …"),
 * `character` is then the typed name and `className` its class.
 */
export type SignupEditPick = { status: SignupStatus; character: string; spec: string; other?: boolean; className?: string };

const keyOf = (name: string) => String(name || "").trim().toLowerCase();

/** A typed name: letters only, one or two parts of 2–12 (the server checks the version's rule again). */
const NAME_PART = /^\p{L}{2,12}$/u;
const cleanName = (name: string) => name.trim().replace(/\s+/g, " ");

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
    const role = roleOf(data, pick.spec);
    const spec = entry?.spec
        || option.specs.find((s) => s.inProfile && s.role === role)?.key
        || option.specs.find((s) => s.inProfile)?.key
        || option.specs[0]?.key
        || "";
    return { status: pick.status, character: option.character, spec };
}

/** The role of a spec key, from the options or the rule set. */
function roleOf(data: SetupSignupEdit, spec: string) {
    return data.options.flatMap((o) => o.specs).find((s) => s.key === spec)?.role
        ?? (data.classes || []).flatMap((c) => c.specs).find((s) => s.key === spec)?.role;
}

/** The option of the picked character — none while the orga names another one. */
export function optionOf(data: SetupSignupEdit, pick: SignupEditPick): SetupSignupOption | undefined {
    if (pick.other) return undefined;
    return data.options.find((o) => o.key === keyOf(pick.character));
}

/** A class of the event's rule set. */
export function classOf(data: SetupSignupEdit, classId: string | undefined): SetupSignupClass | undefined {
    return (data.classes || []).find((c) => c.id === classId);
}

/** "Anderer Charakter …": an empty name, the class of the current character, its spec kept. */
export function pickOther(data: SetupSignupEdit, pick: SignupEditPick): SignupEditPick {
    if (pick.other) return pick;
    const next: SignupEditPick = { status: pick.status, other: true, character: "", className: "", spec: pick.spec };
    const classId = optionOf(data, pick)?.classId || "";
    return classOf(data, classId) ? pickClass(data, next, classId) : { ...next, spec: "" };
}

/** The class of the named character: the same spec if the class has it, else the spec of the same role, else its first. */
export function pickClass(data: SetupSignupEdit, pick: SignupEditPick, classId: string): SignupEditPick {
    const cls = classOf(data, classId);
    if (!cls) return pick;
    const role = roleOf(data, pick.spec);
    const spec = cls.specs.find((s) => s.key === pick.spec)?.key
        || cls.specs.find((s) => s.role === role)?.key
        || cls.specs[0]?.key
        || "";
    return { ...pick, className: cls.id, spec };
}

/**
 * Why the named character cannot be saved yet: "name" (empty or not a name),
 * "taken" (a character the dialog already offers — pick that one instead),
 * "class", "spec"; "" when it can.
 */
export function otherProblem(data: SetupSignupEdit, pick: SignupEditPick): "" | "name" | "taken" | "class" | "spec" {
    if (!pick.other) return "";
    const name = cleanName(pick.character);
    const parts = name.split(" ");
    if (!name || parts.length > 2 || !parts.every((p) => NAME_PART.test(p))) return "name";
    if (data.options.some((o) => o.key === keyOf(name))) return "taken";
    const cls = classOf(data, pick.className);
    if (!cls) return "class";
    if (!cls.specs.some((s) => s.key === pick.spec)) return "spec";
    return "";
}

/** Whether the picked spec is one the raider's profile does not list — the dialog says so. */
export function outsideProfile(data: SetupSignupEdit, pick: SignupEditPick): boolean {
    const spec = optionOf(data, pick)?.specs.find((s) => s.key === pick.spec);
    return !!spec && !spec.inProfile;
}

/** Whether anything differs from where the dialog started — a named character always does. */
export function pickChanged(start: SignupEditPick, pick: SignupEditPick): boolean {
    if (pick.other && pick.status !== "absence") return true;
    return start.status !== pick.status || keyOf(start.character) !== keyOf(pick.character) || start.spec !== pick.spec;
}

/** Whether the dialog may save: something changed and a named character is complete. */
export function canSave(data: SetupSignupEdit, start: SignupEditPick, pick: SignupEditPick): boolean {
    if (!pickChanged(start, pick)) return false;
    return pick.status === "absence" || otherProblem(data, pick) === "";
}

/** The request: `from` is the character the setup shows — the one this pick replaces; an absence sends no character. */
export function signupEditInput(userId: string, start: SignupEditPick, pick: SignupEditPick): SetupSignupInput {
    if (pick.status === "absence") return { userId, status: pick.status, from: start.character };
    if (pick.other) return { userId, status: pick.status, from: start.character, character: cleanName(pick.character), spec: pick.spec, className: pick.className };
    return { userId, status: pick.status, from: start.character, character: pick.character, spec: pick.spec };
}

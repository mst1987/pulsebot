// Class, spec and role names in the active menu language. The server sends
// German labels (src/config/gameVersions/classes.js) next to stable English
// ids ("Warrior", "BeastMastery", "healer"); the page shows the id's text from
// the dictionaries (i18n/locales/<lang>/wow.json) and falls back to whatever
// label the server sent for an id the dictionaries do not know.
import { tOr } from "../i18n";

/** "Priest" -> "Priester" / "Priest". */
export function classLabel(classId: string, fallback = ""): string {
    return tOr(`wow.class.${classId}`, fallback || classId);
}

/** "BeastMastery" -> "Tierherrschaft" / "Beast Mastery". Takes a full "Hunter-BeastMastery" key too. */
export function specLabel(specId: string, fallback = ""): string {
    const id = String(specId || "").includes("-") ? String(specId).split("-").pop() || "" : String(specId || "");
    return tOr(`wow.spec.${id}`, fallback || id);
}

/** "healer" -> "Heiler" / "Healer". */
export function roleLabel(role: string, fallback = ""): string {
    return tOr(`wow.role.${role}`, fallback || role);
}

/** "healer" -> "Heiler" / "Healers" — a role as a group of people. */
export function rolePluralLabel(role: string, fallback = ""): string {
    return tOr(`wow.rolePlural.${role}`, fallback || role);
}

/** "bt" -> "Schwarzer Tempel" / "Black Temple"; an instance the dictionaries lack keeps the server's name. */
export function instanceName(id: string, fallback = ""): string {
    return tOr(`wow.instance.${id}`, fallback || id);
}

// Class, spec and role names in the active menu language. The server sends
// German labels (src/config/gameVersions/classes.js) next to stable English
// ids ("Warrior", "BeastMastery", "healer"); the page shows the id's text from
// the dictionaries (i18n/locales/<lang>/wow.json) and falls back to whatever
// label the server sent for an id the dictionaries do not know.
import { getLang, tOr } from "../i18n";

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

/** A loot council spec key: "Warlock-Destruction" -> "Zerstörungs-Hexer" / "Destruction Warlock" (the server's label for an unknown key). */
export function specClassLabel(specKey: string, fallback = ""): string {
    return tOr(`wow.specClass.${specKey}`, fallback || specKey);
}

/** An equip slot by its WCL index: 0 -> "Kopf" / "Head" (the server's slot name for an unknown index). */
export function slotLabel(slot: number, fallback = ""): string {
    return tOr(`wow.slot.${slot}`, fallback || String(slot));
}

/**
 * A loot content (src/config/tbcContent.js) by its id: in German the server's
 * own label stays ("Festung der Stürme — Das Auge", which is longer than the
 * instance name), in English the instance's name ("Tempest Keep").
 */
export function contentName(id: string, serverLabel: string): string {
    return getLang() === "de" ? serverLabel : instanceName(id, serverLabel);
}

/** "bt" -> "Schwarzer Tempel" / "Black Temple"; an instance the dictionaries lack keeps the server's name. */
export function instanceName(id: string, fallback = ""): string {
    return tOr(`wow.instance.${id}`, fallback || id);
}

// Character names in the Kaderplaner: a Forever name ("Vorname Nachname",
// 2–12 letters each, src/utils/signup/characterNames.js) or a free nickname
// (2–24 letters, digits, space, hyphen, apostrophe). The server checks both
// again, the profanity filter included; this is the quick check while typing.
import type { KaderNameStyle } from "../../api";

const NAME_PART = /^\p{L}{2,12}$/u;
const NICK = /^[\p{L}\p{N}' -]{2,24}$/u;

/** "Vorname Nachname" → ["Vorname", "Nachname"]. */
export function splitName(name: string): [string, string] {
    const i = name.indexOf(" ");
    return i < 0 ? [name, ""] : [name.slice(0, i), name.slice(i + 1)];
}

/** Whether a name fits its style. */
export function nameOk(name: string, style: KaderNameStyle): boolean {
    if (style === "nick") return NICK.test(name.trim().replace(/\s+/g, " "));
    const [a, b] = splitName(name);
    return NAME_PART.test(a) && NAME_PART.test(b);
}

/** The style a stored name without one looks like: two parts are a Forever name. */
export function inferNameStyle(name: string): KaderNameStyle {
    return name.trim().split(/\s+/).length === 2 ? "forever" : "nick";
}

/** The name carried over when the style is switched. */
export function switchNameStyle(name: string, to: KaderNameStyle): string {
    const clean = name.trim().replace(/\s+/g, " ");
    if (to === "nick") return clean;
    const [a, b] = splitName(clean);
    return `${a.replace(/[^\p{L}]/gu, "").slice(0, 12)} ${b.replace(/[^\p{L}]/gu, "").slice(0, 12)}`;
}

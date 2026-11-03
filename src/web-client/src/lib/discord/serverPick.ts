import type { DiscordServerChoice } from "../../api";

// How a server of the server list is named where a page offers it (#895).

/** What a server is called: its Discord name, else the orga's label, else its id. */
export function serverName(s: Pick<DiscordServerChoice, "name" | "label" | "guildId">): string {
    return s.name || s.label || s.guildId;
}

/** A name cut to `max` characters with an ellipsis, for the segment (the full name goes into the tooltip). */
export function shortName(name: string, max = 22): string {
    return name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name;
}

/** The orga's label as an addition, only where it says something the name does not. */
export function serverExtra(s: Pick<DiscordServerChoice, "name" | "label">): string {
    return s.name && s.label && s.label !== s.name ? s.label : "";
}

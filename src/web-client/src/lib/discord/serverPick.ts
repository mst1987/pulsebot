import type { DiscordServerChoice } from "../../api";

// Which server of the server list a page of System › Discord shows (#895).
// The pick lives in the URL (`?guild=<id>`); the first server of the list is
// the default and needs no parameter. An old link from before the server list
// (`?side=talk`) still opens the old talk server - the one the API marks
// `legacyTalk`, the same the backend resolves (guildRoles.resolveServer) -,
// else the first server.

/** The server a page shows: a known `guild` from the URL, an old `side=talk`, else the first. "" = no server set. */
export function pickedGuild(servers: DiscordServerChoice[], guild: string | null, side: string | null): string {
    if (!servers.length) return "";
    if (guild && servers.some((s) => s.guildId === guild)) return guild;
    const talk = side === "talk" ? servers.find((s) => s.legacyTalk) : undefined;
    return talk ? talk.guildId : servers[0].guildId;
}

/** The URL parameter for a server: none for the first server of the list. */
export function guildParam(servers: DiscordServerChoice[] | null, guildId: string): Record<string, string> {
    if (!guildId || !servers || !servers.length || servers[0].guildId === guildId) return {};
    return { guild: guildId };
}

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

import { useOutletContext } from "react-router-dom";
import { getServerChoices, type DiscordServerChoice } from "../api";
import type { ShellContext } from "../components/shell/Shell";
import { useApi } from "./useApi";

// The server of System › Discord: Übersicht, Rollen, Mitglieder and
// Rollen-Nachrichten show the server active in the session, the one the sidebar
// names (components/shell/ServerHeader.tsx). That head is the only way to switch;
// it reloads the app, so a page never sees the server change under it. A server
// outside the server list (Einstellungen › Discord) is still asked for, so the
// API's "unknown_guild" says why there is nothing, instead of showing another server.

/** The server list, kept by the module so switching tabs needs no second request. */
let cached: DiscordServerChoice[] | null = null;

/** Only for tests: forget the kept server list. */
export function resetServerPickCache() {
    cached = null;
}

export type ServerPick = {
    /** the servers of the list, null while loading (or when the call failed) */
    servers: DiscordServerChoice[] | null;
    /** the active server, without one the first of the list; "" when none is set — the API then takes the first */
    guildId: string;
    /** true once the list is settled — load the page's data only then */
    ready: boolean;
    /** why the server list failed to load ("" when it loaded) — a page says so instead of "offline" */
    error: string;
};

export function useServerPick(): ServerPick {
    const activeGuildId = useOutletContext<ShellContext | undefined>()?.activeGuildId || "";
    const list = useApi(() => getServerChoices().then((l) => (cached = l)), [], { initial: cached });
    const servers = list.data;
    const guildId = activeGuildId || servers?.[0]?.guildId || "";
    const ready = !!servers || !!list.error;
    const error = list.error ? list.error.message || "?" : "";
    return { servers, guildId, ready, error };
}

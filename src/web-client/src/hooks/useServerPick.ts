import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { getServerChoices, type DiscordServerChoice } from "../api";
import { useApi } from "./useApi";
import { guildParam, pickedGuild } from "../lib/discord/serverPick";

// The server pick of System › Discord (#895): Übersicht, Rollen, Mitglieder and
// Rollen-Nachrichten each show one server of the server list (Einstellungen ›
// Discord). The pick lives in the URL (`?guild=<id>`, none for the first server)
// so a link and the browser's back button keep it, and the Discord tabs carry it
// from page to page. `components/channels/ServerPicker.tsx` draws the choice.

/** The server list, kept by the module so switching tabs draws the picker at once. */
let cached: DiscordServerChoice[] | null = null;

/** Only for tests: forget the kept server list. */
export function resetServerPickCache() {
    cached = null;
}

export type ServerPick = {
    /** the servers of the list, null while loading (or when the call failed) */
    servers: DiscordServerChoice[] | null;
    /** the picked server; "" before the list is there or when none is set — the API then takes the first */
    guildId: string;
    /** true once the pick is settled — load the page's data only then */
    ready: boolean;
    /** switches the server; `drop` names further URL parameters that belong to the old server (an open drawer) */
    choose: (guildId: string, drop?: string[]) => void;
    /** the URL parameters for a server, for links that should keep it ({} for the first server) */
    param: (guildId: string) => Record<string, string>;
};

export function useServerPick(): ServerPick {
    const [params, setParams] = useSearchParams();
    const list = useApi(() => getServerChoices().then((l) => (cached = l)), [], { initial: cached });
    const servers = list.data;
    const guildId = servers ? pickedGuild(servers, params.get("guild"), params.get("side")) : "";
    const ready = !!servers || !!list.error;
    const choose = useCallback((next: string, drop: string[] = []) => {
        setParams((prev) => {
            const out = new URLSearchParams(prev);
            for (const key of ["guild", "side", ...drop]) out.delete(key);
            for (const [k, v] of Object.entries(guildParam(servers, next))) out.set(k, v);
            return out;
        }, { replace: true });
    }, [servers, setParams]);
    const param = useCallback((id: string) => guildParam(servers, id), [servers]);
    return { servers, guildId, ready, choose, param };
}

/** The query string ("" or "?guild=…") that keeps the picked server on a link. */
export function pickSearch(pick: Pick<ServerPick, "param" | "guildId">): string {
    const q = new URLSearchParams(pick.param(pick.guildId)).toString();
    return q ? `?${q}` : "";
}

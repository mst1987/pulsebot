import { createContext, useContext } from "react";
import type { ContentVersionRef } from "../api/session";

// The one global game version of the web admin (#563): the shell holds it
// (components/shell/ContentVersionProvider.tsx), the top bar switches it
// (components/shell/ContentSwitch.tsx), every page that lists content reads it here
// and asks the server with `?version=` — instead of a version filter of its
// own (#545). Rules in lib/contentVersion.ts.

export type ContentVersionState = {
    /** The version shown now — "" only without session content (the server then picks the main version). */
    version: string;
    mainVersion: string;
    /** "Andere Versionen ausblenden" is on: no switch, only the main version. */
    hidden: boolean;
    /** The versions offered, main version first. */
    versions: ContentVersionRef[];
    setVersion: (versionId: string) => void;
    /** Reads the session again — after the settings changed the main version or the hiding. */
    refresh: () => Promise<void>;
};

const NOOP_STATE: ContentVersionState = {
    version: "", mainVersion: "", hidden: false, versions: [],
    setVersion: () => undefined,
    refresh: () => Promise.resolve(),
};

export const ContentVersionContext = createContext<ContentVersionState>(NOOP_STATE);

/** The global content version (#563). Outside the shell (a page test) it is "" = the server's main version. */
export function useContentVersion(): ContentVersionState {
    return useContext(ContentVersionContext);
}

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSession, type ContentInfo } from "../../api/session";
import { ContentVersionContext, type ContentVersionState } from "../../hooks/useContentVersion";
import { EMPTY_CONTENT, readStoredVersion, resolveContentVersion, writeStoredVersion } from "../../lib/app/contentVersion";
import { applyVersionColors, markVersion } from "../../lib/app/versionColor";

// Holds the global content version (#563) for everything inside the shell:
// seeded from the session's `content`, the user's pick from localStorage.
// It also puts the version on the root (<html data-version>, #742): tokens.css
// turns the accent into the version's colour from it. A `neutral` page
// (Einstellungen, Systemstatus, Kanäle: menu.json) leaves the attribute off and
// keeps the brand colour.
export default function ContentVersionProvider({ content, neutral = false, children }: { content?: ContentInfo | null; neutral?: boolean; children: ReactNode }) {
    const [info, setInfo] = useState<ContentInfo>(content || EMPTY_CONTENT);
    const [picked, setPicked] = useState<string>(() => readStoredVersion());

    const setVersion = useCallback((versionId: string) => {
        setPicked(versionId);
        writeStoredVersion(versionId, info);
    }, [info]);

    const refresh = useCallback(async () => {
        try {
            const session = await getSession();
            if (session.content) setInfo(session.content);
        } catch {
            // The switch keeps what it had; the next page load reads it again.
        }
    }, []);

    const version = resolveContentVersion(picked, info);
    useEffect(() => { applyVersionColors(document.documentElement, info.versions); }, [info.versions]);
    useEffect(() => {
        markVersion(document.documentElement, neutral || !version ? null : version);
        return () => markVersion(document.documentElement, null);
    }, [version, neutral]);

    const value = useMemo<ContentVersionState>(() => ({
        version,
        mainVersion: info.mainVersion,
        hidden: info.hideOtherVersions,
        versions: info.versions,
        setVersion,
        refresh,
    }), [version, info, setVersion, refresh]);

    return <ContentVersionContext.Provider value={value}>{children}</ContentVersionContext.Provider>;
}

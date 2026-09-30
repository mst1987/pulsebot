import { useCallback, useMemo, useState, type ReactNode } from "react";
import { getSession, type ContentInfo } from "../api/session";
import { ContentVersionContext, type ContentVersionState } from "../hooks/useContentVersion";
import { EMPTY_CONTENT, readStoredVersion, resolveContentVersion, writeStoredVersion } from "../lib/contentVersion";

// Holds the global content version (#563) for everything inside the shell:
// seeded from the session's `content`, the user's pick from localStorage.
export default function ContentVersionProvider({ content, children }: { content?: ContentInfo | null; children: ReactNode }) {
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

    const value = useMemo<ContentVersionState>(() => ({
        version: resolveContentVersion(picked, info),
        mainVersion: info.mainVersion,
        hidden: info.hideOtherVersions,
        versions: info.versions,
        setVersion,
        refresh,
    }), [picked, info, setVersion, refresh]);

    return <ContentVersionContext.Provider value={value}>{children}</ContentVersionContext.Provider>;
}

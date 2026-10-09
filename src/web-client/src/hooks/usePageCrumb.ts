import { createContext, useContext, useEffect } from "react";

/**
 * How a page names its own third breadcrumb segment: the shell provides the
 * setter around its page outlet (components/shell/Shell.tsx). Its own context,
 * not the outlet context — that one carries the user only.
 */
export const PageCrumbContext = createContext<((label: string | null) => void) | null>(null);

/**
 * The third breadcrumb segment of a page whose name only its data knows (one
 * roster: "Menü / Roster / Raid Mo / Do"). The shell shows it while the page
 * is open and drops it when the page leaves; outside the shell (a page test)
 * it does nothing. `null` while the name is not loaded yet.
 */
export function usePageCrumb(label: string | null): void {
    const setCrumb = useContext(PageCrumbContext);
    useEffect(() => {
        if (!setCrumb) return undefined;
        setCrumb(label);
        return () => setCrumb(null);
    }, [setCrumb, label]);
}

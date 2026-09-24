import { useEffect, useRef } from "react";

/** Calls `fn` when the browser window gets the focus back or the page becomes visible again (the latest `fn` each time). */
export function useOnFocus(fn: () => void): void {
    const ref = useRef(fn);
    ref.current = fn;
    useEffect(() => {
        const again = () => {
            if (document.visibilityState !== "hidden") ref.current();
        };
        window.addEventListener("focus", again);
        document.addEventListener("visibilitychange", again);
        return () => {
            window.removeEventListener("focus", again);
            document.removeEventListener("visibilitychange", again);
        };
    }, []);
}

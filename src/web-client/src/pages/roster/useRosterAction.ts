// One way the roster views run a write (#655-#657): which button is busy, the
// result as a toast (the shared channel, components/shell/Jobs.tsx), a refusal
// translated from its code (lib/roster/rosterEdit.ts errorText) - never the
// server's German text, never swallowed.
import { useCallback, useState } from "react";
import type { ApiError } from "../../api";
import { useToast } from "../../components/shell/Jobs";
import { errorText } from "../../lib/roster/rosterEdit";

export type RosterRun = <T>(id: string, fn: () => Promise<T>, okText?: (result: T) => string | null) => Promise<T | null>;

export function useRosterAction(): { run: RosterRun; busy: string } {
    const notify = useToast();
    const [busy, setBusy] = useState("");
    const run = useCallback<RosterRun>(async (id, fn, okText) => {
        setBusy(id);
        try {
            const result = await fn();
            const text = okText ? okText(result) : null;
            if (text) notify(text, "ok");
            return result;
        } catch (err) {
            notify(errorText(err as ApiError), "err");
            return null;
        } finally {
            setBusy("");
        }
    }, [notify]);
    return { run, busy };
}

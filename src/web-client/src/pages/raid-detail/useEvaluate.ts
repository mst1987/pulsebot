import { useState } from "react";
import type { LogSection, RaidLogRow } from "../../api";
import { evalLog } from "../../api";
import { withIncompleteConfirm } from "../../lib/confirmIncomplete";
import { useConfirm } from "../../components/ui/Modal";
import { useJobs } from "../../components/Jobs";
import { EVAL_SECONDS } from "./meta";

/** Starts one analysis as a background job; shared with the page head's primary action. */
export default function useEvaluate(ctx: { csrfToken: string | null; onChanged: (msg: string) => void }) {
    const ask = useConfirm();
    const jobs = useJobs();
    const [running, setRunning] = useState<string[]>([]);

    const evaluate = (log: Pick<RaidLogRow, "id" | "title" | "reportId">, section: LogSection) => {
        const label = section.toUpperCase();
        const key = `${log.id}:${section}`;
        setRunning((keys) => [...keys, key]);
        jobs.run({
            label: `${label}-Auswertung`,
            detail: log.title || log.reportId || "",
            icon: "inv_misc_pocketwatch_01",
            expectedSeconds: EVAL_SECONDS[section],
            describe: (r) => ({
                message: r.alreadyEvaluated ? `${label}-Auswertung lag bereits vor.` : `${label}-Auswertung erstellt.`,
                link: r.url ? { href: r.url, label: "Report ansehen", external: true } : undefined,
            }),
        }, () => withIncompleteConfirm(ask, (force) => evalLog(ctx.csrfToken, log.id, section, { force }))).then(() => {
            setRunning((keys) => keys.filter((k) => k !== key));
            ctx.onChanged("");
        });
    };

    return { evaluate, isRunning: (logId: string, section: LogSection) => running.includes(`${logId}:${section}`) };
}

export type Evaluator = ReturnType<typeof useEvaluate>;

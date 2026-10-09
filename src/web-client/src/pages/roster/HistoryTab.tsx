// The history of a roster (#655, tab "Verlauf"): every change newest first -
// who, when, what - a page of 50 at a time with "Mehr zeigen". The member
// drawer shows the same lines for one person (HistoryLines). The server sends
// the stored codes; lib/roster/rosterEdit.ts historyText words them.
import { useState } from "react";
import { getRosterHistory, type ApiError, type RosterHistoryEntry, type RosterHistoryPage } from "../../api";
import { useApi } from "../../hooks/useApi";
import { useT } from "../../i18n";
import { AsyncView, Button } from "../../components/ui";
import RaidLoader from "../../components/ui/RaidLoader";
import { useToast } from "../../components/shell/Jobs";
import { formatDate, formatTime } from "../../lib/format";
import { errorText, historyText } from "../../lib/roster/rosterEdit";

const PAGE = 50;

/** The history lines: date (with the time in the tooltip), the change in words, who did it. */
export function HistoryLines({ entries, withUser = true }: { entries: RosterHistoryEntry[]; withUser?: boolean }) {
    const t = useT();
    return (
        <ol className="rn-hist">
            {entries.map((e, i) => {
                const at = Date.parse(e.at);
                const ok = Number.isFinite(at);
                return (
                    <li key={`${e.at}-${i}`} data-what={e.what}>
                        <time dateTime={e.at} data-tip={ok ? `${formatDate(at)} ${formatTime(at)}` : undefined}>{ok ? formatDate(at) : ""}</time>
                        <span className="rn-hist-text">{historyText(e, withUser)}</span>
                        <span className="rn-sub rn-hist-by">{e.byName ? t("roster.hist.by", { name: e.byName }) : t("roster.hist.byBot")}</span>
                    </li>
                );
            })}
        </ol>
    );
}

function HistoryList({ rosterId, first }: { rosterId: string; first: RosterHistoryPage }) {
    const t = useT();
    const notify = useToast();
    // the pages loaded with "Mehr zeigen", for the first page they continue
    const [extra, setExtra] = useState<{ base: RosterHistoryPage; entries: RosterHistoryEntry[] } | null>(null);
    const [loading, setLoading] = useState(false);
    const more = extra && extra.base === first ? extra.entries : [];
    const entries = [...first.entries, ...more];

    const loadMore = async () => {
        setLoading(true);
        try {
            const page = await getRosterHistory(rosterId, { offset: entries.length, limit: PAGE });
            setExtra({ base: first, entries: [...more, ...page.entries] });
        } catch (err) {
            notify(errorText(err as ApiError), "err");
        } finally {
            setLoading(false);
        }
    };

    return (
        <section className="rn-panel rn-pad rn-hist-panel" aria-label={t("roster.hist.title")}>
            <div className="rn-sec-head">
                <h2 className="rn-h3">{t("roster.hist.title")}</h2>
                <span className="rn-sub">{t("roster.hist.count", { count: first.total })}</span>
            </div>
            {!entries.length ? <p className="rn-empty">{t("roster.hist.empty")}</p> : <HistoryLines entries={entries} />}
            {entries.length < first.total && (
                <div className="rn-more">
                    <Button variant="ghost" running={loading} onClick={loadMore}>{t("roster.hist.more", { count: Math.min(PAGE, first.total - entries.length) })}</Button>
                </div>
            )}
        </section>
    );
}

export default function HistoryTab({ rosterId, reloadKey }: { rosterId: string; reloadKey: number }) {
    const t = useT();
    const state = useApi(() => getRosterHistory(rosterId, { offset: 0, limit: PAGE }), [rosterId, reloadKey]);
    return (
        <AsyncView state={state} loading={<RaidLoader compact text={t("roster.hist.loading")} />} error={(e) => <p className="rn-empty">{errorText(e)}</p>}>
            {(first) => <HistoryList rosterId={rosterId} first={first} />}
        </AsyncView>
    );
}

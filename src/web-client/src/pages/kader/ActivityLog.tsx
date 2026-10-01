// The logs of the Kaderplaner (docs/kaderplaner.md, "Verlauf und Aktivität"):
// who changed what and when lives here, not on the working surfaces.
//
// - HistoryButton: "Verlauf" of one player — a small clock button in the
//   interview's head, the drawer's head and the account dialog that opens the
//   player's history, newest first ("01.10. 19:49 · Gespräch gespeichert ·
//   Devihra"): states, interviewer, interview saved/completed/reopened, votes,
//   decision.
// - ActivityModal: "Aktivität" of the Kader — the last 50 changes over all
//   players, newest first, filterable by person (header button next to the
//   settings). Types and names only: answers, notes and comments never show.
import { useMemo, useRef, useState } from "react";
import type { KaderEntry } from "../../api";
import { Modal, buttonClass } from "../../components/ui";
import Popover from "../../components/ui/Popover";
import { ClockIcon } from "../../components/icons";
import { useT } from "../../i18n";
import { usePersistedState } from "../../lib/persistedState";
import { belowStartPlacement } from "../../lib/popoverPosition";
import { activityText } from "../../lib/kader/live";
import { LEAD_ALL } from "../../lib/kader/leads";
import { historyText, nameOf, playerName, stampOf } from "../../lib/kader/model";
import { EmptyState, Count } from "./parts";
import { LeadAvatar, LeadMenu, type LeadOption } from "./Leads";
import { useKader } from "./kaderContext";

// under the button, kept inside the viewport (a phone, the drawer's right edge)
const below = belowStartPlacement();

/** A person in a log line: their coloured initial and name. */
function Who({ userId }: { userId: string }) {
    const { view } = useKader();
    return (
        <span className="kp-logwho">
            <LeadAvatar userId={userId} size={18} />
            <span className="kp-ellipsis">{nameOf(view, userId)}</span>
        </span>
    );
}

/** "Verlauf" of one player: a small button that opens the history as a panel under it. */
export function HistoryButton({ userId, entry }: { userId: string; entry: KaderEntry }) {
    const t = useT();
    const { view } = useKader();
    const [open, setOpen] = useState(false);
    const anchor = useRef<HTMLButtonElement>(null);
    const name = playerName(view, userId, entry);
    const items = [...entry.history].reverse();
    return (
        <>
            <button ref={anchor} type="button" className={buttonClass("ghost", "sm", true, "kp-logbtn")} aria-haspopup="dialog" aria-expanded={open}
                data-tip={t("kader.log.historyTip", { name })} onClick={() => setOpen(!open)}>
                <ClockIcon />{t("kader.log.history")}
            </button>
            {open && (
                <Popover anchor={anchor} place={below} follow="reposition" host="dialog" onClose={() => setOpen(false)} className="kp-logpop"
                    role="dialog" aria-label={t("kader.log.historyTitle", { name })}>
                    <div className="kp-logpop-head">
                        <ClockIcon />
                        <span className="kp-strong kp-ellipsis">{t("kader.log.historyTitle", { name })}</span>
                        <Count n={items.length} tip={t("kader.log.count", { count: items.length })} className="kp-count-quiet" />
                    </div>
                    {items.length === 0 ? <p className="kp-hint">{t("kader.log.historyEmpty")}</p> : (
                        <ol className="kp-loglist">
                            {items.map((h, i) => (
                                <li key={`${h.at}-${i}`}>
                                    <span className="kp-logtime kp-mono">{stampOf(h.at)}</span>
                                    <span className="kp-logtext">{historyText(view, h)}</span>
                                    <Who userId={h.by} />
                                </li>
                            ))}
                        </ol>
                    )}
                </Popover>
            )}
        </>
    );
}

/** "Aktivität" of the Kader: the last 50 changes, newest first, filterable by person. */
export default function ActivityModal({ onClose }: { onClose: () => void }) {
    const t = useT();
    const { view, kader } = useKader();
    const [person, setPerson] = usePersistedState<string>("kader-activity-person", LEAD_ALL);
    const items = useMemo(() => [...(kader.activity || [])].reverse(), [kader]);
    const people = useMemo(() => [...new Set(items.map((a) => a.by))], [items]);
    const pick = people.includes(person) ? person : LEAD_ALL;
    const shown = pick === LEAD_ALL ? items : items.filter((a) => a.by === pick);
    const options: LeadOption[] = [
        { value: LEAD_ALL, label: t("kader.log.all"), badge: <span className="kp-lead-name">{t("kader.log.all")}</span>, count: items.length },
        ...people.map((id) => ({ value: id, label: nameOf(view, id), badge: <Who userId={id} />, count: items.filter((a) => a.by === id).length })),
    ];
    return (
        <Modal open onClose={onClose} icon={<ClockIcon />} tone="kader" kicker={t("kader.log.activity")} title={t("kader.log.activityTitle", { name: kader.name })}
            width={620} className="kp-dialog kp-activity" hint={t("kader.log.activityHint")}>
            <div className="kp-stack">
                {people.length > 1 && <LeadMenu label={t("kader.log.person")} prefix={t("kader.log.person")} value={pick} options={options} onChange={setPerson} className="kp-leadfilter" />}
                {shown.length === 0 ? <EmptyState icon={<ClockIcon />} text={t("kader.log.activityEmpty")} /> : (
                    <ol className="kp-loglist kp-loglist-wide">
                        {shown.map((a) => (
                            <li key={`${a.rev}-${a.type}-${a.playerId || ""}`}>
                                <span className="kp-logtime kp-mono">{stampOf(a.at)}</span>
                                {/* the sentence names the person; the initial in their colour finds them at a glance */}
                                <span className="kp-logtext kp-logline"><LeadAvatar userId={a.by} size={18} />{activityText(view, kader, a)}</span>
                            </li>
                        ))}
                    </ol>
                )}
            </div>
        </Modal>
    );
}

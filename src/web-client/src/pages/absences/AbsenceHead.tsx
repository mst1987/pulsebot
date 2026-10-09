import type { AbsenceHint, AbsenceOverview } from "../../api";
import { Button } from "../../components/ui";
import { AbsenceIcon, InfoIcon } from "../../components/ui/icons";
import { namesOf } from "../../lib/roster/absences";
import { dayMs } from "../../lib/signups/availability";
import { formatDayDate, formatDayMonth } from "../../lib/format";
import { useT } from "../../i18n";
import { AbSpec, ClassName } from "./parts";

// The four figures under the head of Roster › Abwesenheiten — a big number with
// its word, the names small — and the quiet hint cards ("Hinweis") for raiders
// who keep signing off from single raids without entering a period.

export function AbsenceTiles({ data }: { data: AbsenceOverview }) {
    const t = useT();
    const today = namesOf(data.tiles.today, data.raiders);
    const biggest = data.tiles.biggest;
    return (
        <div className="ab-tiles">
            <div className={`ab-tile${today.length ? " ab-warn" : ""}`}>
                <div className="ab-tile-num"><b>{data.tiles.today.length}</b> {t("absences.tiles.today")}</div>
                {today.length > 0 && <div className="ab-tile-sub">{today.join(", ")}</div>}
            </div>
            <div className="ab-tile">
                <div className="ab-tile-num"><b>{data.tiles.nextWeek.length}</b> {t("absences.tiles.nextWeek")}</div>
                {data.tiles.nextWeek.length > 0 && <div className="ab-tile-sub">{namesOf(data.tiles.nextWeek, data.raiders).join(", ")}</div>}
            </div>
            <div className="ab-tile">
                <div className="ab-tile-num"><b>{data.tiles.long.length}</b> {t("absences.tiles.long")}</div>
                {data.tiles.long.length > 0 && <div className="ab-tile-sub">{namesOf(data.tiles.long, data.raiders).join(", ")}</div>}
            </div>
            <div className={`ab-tile${biggest ? " ab-warn" : ""}`} data-tip={biggest ? biggest.title : undefined}>
                {biggest ? (
                    <>
                        <div className="ab-tile-num"><b>{formatDayDate(dayMs(biggest.day))}</b></div>
                        <div className="ab-tile-sub">{biggestText(biggest, t)}</div>
                    </>
                ) : (
                    <>
                        <div className="ab-tile-num"><b>0</b> {t("absences.tiles.noGap")}</div>
                        <div className="ab-tile-sub">{t("absences.tiles.noGapSub")}</div>
                    </>
                )}
            </div>
        </div>
    );
}

/** "größte Lücke: 4 fehlen, davon 2 Heiler" */
function biggestText(b: NonNullable<AbsenceOverview["tiles"]["biggest"]>, t: ReturnType<typeof useT>): string {
    const roles = [
        b.healers ? t("absences.tiles.healers", { count: b.healers }) : "",
        b.tanks ? t("absences.tiles.tanks", { count: b.tanks }) : "",
    ].filter(Boolean);
    const base = t("absences.tiles.biggest", { count: b.away });
    return roles.length ? `${base}, ${t("absences.tiles.ofThem", { list: roles.join(", ") })}` : base;
}

export function HintCard({ hint, canEdit, onOpen, onEnter }: {
    hint: AbsenceHint;
    canEdit: boolean;
    onOpen: (userId: string) => void;
    onEnter: (hint: AbsenceHint) => void;
}) {
    const t = useT();
    return (
        <section className="ab-hintcard" aria-label={t("absences.hint.title")}>
            <span className="ab-hint-ic" aria-hidden="true"><InfoIcon /></span>
            <div className="ab-hint-main">
                <h3>{t("absences.hint.title")}</h3>
                <p>
                    <button type="button" className="ab-linkbtn" onClick={() => onOpen(hint.userId)}>
                        <AbSpec who={hint} size="sm" />
                        <ClassName who={hint} />
                    </button>
                    {" "}{t("absences.hint.text", { count: hint.count, of: hint.of, category: hint.categoryName || t("absences.hint.aCategory") })}
                </p>
                <div className="ab-hint-days">
                    {hint.days.map((d) => (
                        <span key={d} className="ab-hint-day"><i className="ab-mark-ring" aria-hidden="true" />{formatDayMonth(dayMs(d))}</span>
                    ))}
                </div>
            </div>
            {canEdit && (
                <Button variant="ghost" size="sm" icon={<AbsenceIcon />} onClick={() => onEnter(hint)}>{t("absences.hint.enter")}</Button>
            )}
        </section>
    );
}

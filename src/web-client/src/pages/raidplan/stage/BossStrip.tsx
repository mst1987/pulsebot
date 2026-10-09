import { Check } from "lucide-react";
import type { RaidplanPublicBoss } from "../../../api";
import type { StripMode } from "../../../lib/raidplan/sheetLayout";
import { sectionGroups } from "../../../lib/raidplan/stage";
import { useT } from "../../../i18n";

/**
 * The extra boss strip of the sheet's stage (/p/<token>), for a visitor who wants every section in sight as before: one chip per section,
 * in runs of one instance, as a row under the bar ("top") or a column left of the map ("left"). A section where the visitor has a task of
 * his own carries the accent dot (#503), a boss the log shows killed the check (#534) - both said in tooltip and label. Off by default;
 * switched in the section menu ("Boss-Leiste"), remembered in this browser.
 */
export default function BossStrip({ sections, selectedKey, mineKeys, killedKeys, label, mode, onPick }: {
    sections: RaidplanPublicBoss[];
    selectedKey: string;
    mineKeys: Set<string>;
    killedKeys?: Set<string>;
    label: (b: RaidplanPublicBoss) => string;
    mode: Exclude<StripMode, "off">;
    onPick: (key: string) => void;
}) {
    const t = useT();
    return (
        <nav className={`rp-sheet-strip is-${mode}`} aria-label={t("raidBoard.stage.strip")}>
            {sectionGroups(sections).map((run, i) => (
                <div key={`${run.instance}|${i}`} className="rp-sheet-strip-run">
                    {run.instance && <span className="rp-kicker">{run.instance}</span>}
                    <div className="rp-sheet-strip-chips">
                        {run.items.map((b) => {
                            const on = b.key === selectedKey;
                            const mine = mineKeys.has(b.key);
                            const killed = !!killedKeys && killedKeys.has(b.key);
                            const tips = [mine ? t("raidBoard.stage.tagMine") : "", killed ? t("raidBoard.progress.killed") : ""].filter(Boolean);
                            return (
                                <button
                                    key={b.key} type="button" className={`rp-sheet-chip${on ? " is-on" : ""}${killed ? " is-killed" : ""}`}
                                    aria-current={on ? "true" : undefined} aria-label={tips.length ? `${label(b)} (${tips.join(", ")})` : label(b)}
                                    data-tip={tips.length ? tips.join(" · ") : undefined} onClick={() => onPick(b.key)}
                                >
                                    {b.iconUrl ? <img src={b.iconUrl} alt="" width={26} height={26} /> : <span className="rp-sheet-chip-ph" aria-hidden="true" />}
                                    <span className="rp-sheet-chip-name">{label(b)}</span>
                                    {mine && <span className="rp-sheet-chip-mine" aria-hidden="true" />}
                                    {killed && <span className="rp-sheet-chip-done" aria-hidden="true"><Check size={10} strokeWidth={3.5} /></span>}
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}
        </nav>
    );
}

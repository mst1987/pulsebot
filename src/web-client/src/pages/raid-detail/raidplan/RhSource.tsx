// The head line of a Raid-Helper event's raid plan (docs/raidplan.md, "Raid-Helper-Events"): "Aufstellung aus Raid-Helper · Stand
// 19:42", a button that asks Raid-Helper again now, and - only when there is something to say - the warnings (stale, not available, no
// groups) and small notes (names not matched, unknown specs, raiders no longer listed). The line-up itself is read only.
import { RotateCw } from "lucide-react";
import type { RaidplanRosterSource } from "../../../api";
import { IconButton } from "../../../components/ui";
import { rhSourceText } from "../../../lib/raidplan";
import { useT } from "../../../i18n";

export default function RhSource({ src, busy, onReload }: { src: RaidplanRosterSource; busy: boolean; onReload: () => void }) {
    const t = useT();
    const text = rhSourceText(src);
    const at = src.fetchedAt ? new Date(src.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    return (
        <div className={`rp-rhsrc${src.stale || !src.available ? " is-stale" : ""}`}>
            <div className="rp-rhsrc-line">
                <span className="rp-rhsrc-main" data-tip={t("raidBoard.rh.readOnlyTip")}>{text.main}</span>
                {at && <span className="rp-muted">{t("raidBoard.rh.at", { time: at })}</span>}
                {text.notes.map((n) => <span key={n} className="rp-rhsrc-note">{n}</span>)}
                <IconButton size="sm" icon={<RotateCw size={15} />} tip={t("raidBoard.rh.reloadTip")} disabled={busy} onClick={onReload} />
            </div>
            {text.warns.map((w) => <p key={w} className="rp-warn">{w}</p>)}
        </div>
    );
}

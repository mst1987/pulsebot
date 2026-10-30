import { useState } from "react";
import { saveOwnLeads, type ApiError, type LeadVersion } from "../../api";
import { useToast } from "../../components/shell/Jobs";
import { LeadChips } from "../../components/roster/LeadChips";
import { useT } from "../../i18n";

// "Raids leiten" (#1034): which instances the person can lead, per game version,
// as toggle chips. A click saves at once (PUT /api/profile/leads) and counts
// right away — nobody confirms it. Only the versions the person plays (or a
// category plays) show; each version stands on its own line.

export function LeadsPart({ versions, onChange }: { versions: LeadVersion[]; onChange: (next: LeadVersion[]) => void }) {
    const t = useT();
    const toast = useToast();
    const [busy, setBusy] = useState("");

    const save = async (v: LeadVersion, next: string[]) => {
        const before = versions;
        // optimistic: the chip switches at once, the answer brings the stored state
        onChange(versions.map((x) => (x.id === v.id ? { ...x, leads: next } : x)));
        setBusy(v.id);
        try {
            const res = await saveOwnLeads(v.id, next);
            onChange(res.leadVersions);
        } catch (e) {
            onChange(before);
            toast((e as ApiError).message, "err");
        } finally {
            setBusy("");
        }
    };

    if (!versions.length) return <p className="pf-muted">{t("profile.leads.noVersion")}</p>;
    return (
        <div className="pf-leads">
            {versions.map((v) => (
                <div key={v.id} className="pf-leads-row">
                    {versions.length > 1 && <span className="kicker pf-leads-version">{v.label}</span>}
                    <LeadChips
                        instances={v.instances} value={v.leads} disabled={busy === v.id}
                        label={t("profile.leads.chipsAria", { version: v.label })}
                        onChange={(next) => void save(v, next)}
                    />
                </div>
            ))}
        </div>
    );
}

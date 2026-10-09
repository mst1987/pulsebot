// The floating bar of a list with marked rows: how many are marked and what can
// be done with them at once. Only while something is marked.
import type { ReactNode } from "react";
import { XIcon } from "../../components/ui/icons";
import { IconButton } from "../../components/ui";
import { useT } from "../../i18n";

export function BatchBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
    const t = useT();
    if (!count) return null;
    return (
        <div className="kp-batch" role="region" aria-label={t("kader.batch.aria")}>
            <span className="kp-batch-n"><b className="kp-mono">{count}</b> {t("kader.batch.marked")}</span>
            {children}
            <IconButton icon={<XIcon />} size="sm" tip={t("kader.batch.clear")} onClick={onClear} />
        </div>
    );
}

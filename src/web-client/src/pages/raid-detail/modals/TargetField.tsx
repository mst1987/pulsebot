// "Wohin" of the ping and the sign-up call (#264): event channel, the talk
// server's ping channel, or both. One compact segment; without a talk server
// and ping channel there is nothing to choose and nothing is rendered.
import type { PingTarget, PingTargetInfo } from "../../../api";
import Segment from "../../../components/ui/Segment";
import { pingTargetOptions } from "../../../lib/settingsLogic";
import { useT } from "../../../i18n";

export default function TargetField({ info, value, onChange }: {
    info: PingTargetInfo | undefined;
    value: PingTarget;
    onChange: (target: PingTarget) => void;
}) {
    const t = useT();
    const options = pingTargetOptions(info);
    if (!options.length) return null;
    return (
        <div className="field">
            <label
                className="tipped"
                data-tip={t("raidModals.target.tip")}
                data-tip-sub={t("raidModals.target.tipSub")}
            >
                {t("raidModals.target.label")}
            </label>
            <Segment size="sm" ariaLabel={t("raidModals.target.label")} options={options} value={value} onChange={onChange} />
        </div>
    );
}

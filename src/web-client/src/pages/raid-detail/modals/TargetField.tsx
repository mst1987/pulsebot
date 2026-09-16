// "Wohin" of the ping and the sign-up call (#264): event channel, the talk
// server's ping channel, or both. One compact segment; without a talk server
// and ping channel there is nothing to choose and nothing is rendered.
import type { PingTarget, PingTargetInfo } from "../../../api";
import Segment from "../../../components/ui/Segment";
import { pingTargetOptions } from "../../../lib/settingsLogic";

export default function TargetField({ info, value, onChange }: {
    info: PingTargetInfo | undefined;
    value: PingTarget;
    onChange: (target: PingTarget) => void;
}) {
    const options = pingTargetOptions(info);
    if (!options.length) return null;
    return (
        <div className="field">
            <label
                className="tipped"
                data-tip="Wohin"
                data-tip-sub="Event-Kanal wie bisher, der Ping-Kanal des Kommunikations-Discords oder beides. Wer nicht auf dem Kommunikations-Discord ist, bekommt bei „Talk“ eine DM."
            >
                Wohin
            </label>
            <Segment size="sm" ariaLabel="Wohin" options={options} value={value} onChange={onChange} />
        </div>
    );
}

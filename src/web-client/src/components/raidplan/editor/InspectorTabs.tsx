import type { ReactNode } from "react";
import { Segment } from "../../ui";
import { usePersistedState } from "../../../lib/ui/persistedState";

export type InspectorTab<V extends string> = { value: V; label: string };

/**
 * A long inspector split into a few tabs (#528): the UI kit's segment on top, one tab's fields below. The tab last chosen for this kind of
 * object (`id`: "group", "icon", "role") is remembered in this browser, so the next group opens where the last one was left; a stored tab
 * that no longer exists falls back to the first.
 */
export default function InspectorTabs<V extends string>({ id, label, tabs, children }: {
    id: string;
    label: string;
    tabs: InspectorTab<V>[];
    children: (tab: V) => ReactNode;
}) {
    const [stored, setStored] = usePersistedState<string>(`raidplan-insp-tab-${id}`, tabs[0].value);
    const tab = (tabs.find((x) => x.value === stored) || tabs[0]).value;
    return (
        <>
            <div className="rp-insp-tabs">
                <Segment size="sm" ariaLabel={label} options={tabs} value={tab} onChange={(v) => setStored(v)} />
            </div>
            <div className="rp-insp-tab" data-insp-tab={tab}>{children(tab)}</div>
        </>
    );
}

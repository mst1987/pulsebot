import { useEffect, useRef } from "react";
import { useContentVersion } from "./useContentVersion";
import { useToast } from "../components/shell/Jobs";
import { followStep, versionRef } from "../lib/app/contentVersion";
import { useT } from "../i18n";

// A page about one record of a game version (a raid, a Kader, a roster, a
// character) shows it in its own version (#741: the web shows one version at a
// time). Opened through a link while the menu shows another version (a Discord
// post, a bookmark), it switches the menu's content version to the record's and
// says so in a toast ("Du bist jetzt in TBC"); the colours follow the switch.
// Switching the menu away afterwards leaves the record: `onLeave` goes back to
// the list of the version now shown. The one place this happens; the rules are
// lib/app/contentVersion.ts' followStep().

/**
 * Follows the record's version: its stored version, or the versions it can be
 * shown in with the preferred first ("" / [] / undefined while it loads).
 * `onLeave` runs when the user switches the menu to a version the record has not.
 */
export function useFollowVersion(record: string | string[] | null | undefined, onLeave?: () => void): void {
    const t = useT();
    const toast = useToast();
    const { version, versions, mainVersion, hidden, setVersion } = useContentVersion();
    const followed = useRef("");
    const leave = useRef(onLeave);
    leave.current = onLeave;
    const list = (Array.isArray(record) ? record : [record || ""]).filter(Boolean);
    const key = list.join(",");

    useEffect(() => {
        const decision = followStep({ record: list, shown: version, followed: followed.current, offered: versions.map((v) => v.id) });
        if (decision.step === "switch") {
            followed.current = decision.key;
            setVersion(decision.to);
            const ref = versionRef({ mainVersion, hideOtherVersions: hidden, versions }, decision.to);
            toast(t("shell.followVersion.switched", { version: ref.short || ref.label }));
        } else if (decision.step === "mark") {
            followed.current = decision.key;
        } else if (decision.step === "leave") {
            followed.current = "";
            if (leave.current) leave.current();
        }
        // Only another record or another menu version is a reason to look again.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, version]);
}

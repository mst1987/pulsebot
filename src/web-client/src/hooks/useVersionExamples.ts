import { useLang } from "../i18n";
import { examplesFor, type Examples, type VersionExamples } from "../lib/app/versionExamples";
import { useContentVersion } from "./useContentVersion";

/**
 * The examples for input hints: of `version` when the form has chosen one (raid, template),
 * otherwise of the version the menu shows now (#563).
 */
export function useVersionExamples(version?: { examples?: VersionExamples } | null): Examples {
    const lang = useLang();
    const content = useContentVersion();
    const shown = content.versions.find((v) => v.id === content.version) || content.versions[0];
    return examplesFor(version || shown, lang);
}

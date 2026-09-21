import RaidLoader from "./ui/RaidLoader";
import { useT } from "../i18n";

// Full-page loading overlay for long operations (softres create, sheet fill,
// posting). What it shows is the shared RaidLoader, so a wait looks the same
// here as in a page body or a card. Renders nothing while idle.
export default function PageLoader({ show, text }: { show: boolean; text?: string }) {
    const t = useT();
    if (!show) return null;
    return (
        <div className="page-loader">
            <RaidLoader text={text || t("jobs.pageLoader.busy")} />
        </div>
    );
}

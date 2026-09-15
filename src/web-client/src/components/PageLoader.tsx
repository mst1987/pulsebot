import RaidLoader from "./ui/RaidLoader";

// Full-page loading overlay for long operations (softres create, sheet fill,
// posting). What it shows is the shared RaidLoader, so a wait looks the same
// here as in a page body or a card. Renders nothing while idle.
export default function PageLoader({ show, text = "Wird verarbeitet" }: { show: boolean; text?: string }) {
    if (!show) return null;
    return (
        <div className="page-loader">
            <RaidLoader text={text} />
        </div>
    );
}

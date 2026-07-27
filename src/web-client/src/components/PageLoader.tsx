// Full-page loading overlay for long operations (softres create, sheet fill,
// posting), ported from the legacy admin's .page-loader/.pl-rune
// (src/web/renderAdmin.js). Renders nothing while idle.
export default function PageLoader({ show, text = "Wird verarbeitet" }: { show: boolean; text?: string }) {
    if (!show) return null;
    return (
        <div className="page-loader" role="status" aria-live="polite">
            <div className="pl-box">
                <div className="pl-rune"><span className="r1" /><span className="r2" /><span className="r3" /></div>
                <div className="pl-text pl-dots">{text}</div>
            </div>
        </div>
    );
}

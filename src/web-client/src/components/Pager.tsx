// Prev/next pager — mirrors claPager()'s exact text ("Seite X / Y · Z gesamt").
// Shared by the CLA report/log tables and the Historie "Latest Loot" tab, so a
// paged list reads the same wherever it appears.
export default function Pager({ page, onPage }: {
    page: { page: number; totalPages: number; total: number };
    onPage: (p: number) => void;
}) {
    if (!page.total) return null;
    return (
        <div className="pager">
            <button type="button" className={`pager-btn${page.page <= 1 ? " disabled" : ""}`} disabled={page.page <= 1} onClick={() => onPage(page.page - 1)}>‹ Zurück</button>
            <span className="pager-info">Seite {page.page} / {page.totalPages} · {page.total} gesamt</span>
            <button type="button" className={`pager-btn${page.page >= page.totalPages ? " disabled" : ""}`} disabled={page.page >= page.totalPages} onClick={() => onPage(page.page + 1)}>Weiter ›</button>
        </div>
    );
}

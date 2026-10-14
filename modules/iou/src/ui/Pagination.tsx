/** How many rows a list shows before "Show more". */
export const PAGE_SIZE = 50

export function Pagination({ limit, total, onShowMore }: { limit: number; total: number; onShowMore: () => void }) {
  return (
    <div className="feed-pagination">
      <span>
        Showing {Math.min(limit, total)} of {total}
      </span>
      {limit < total && (
        <button type="button" className="button secondary compact" onClick={onShowMore}>
          Show more
        </button>
      )}
    </div>
  )
}

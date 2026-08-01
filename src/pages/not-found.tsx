/**
 * The unknown-path page.
 *
 * It is rendered under an HTTP 404, not a 200 — nginx.conf enumerates the app's real routes and
 * lets everything else fall through to `error_page 404 /index.html`, which serves this bundle
 * while KEEPING the status. An app that answers 200 for every address in existence serves its
 * "page not found" screen as a success: crawlers index it, monitors call it healthy, and a deploy
 * that drops a route looks exactly like a deploy that did not.
 */
import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="wt-state wt-state--empty" role="status">
      <span className="wt-state__icon" aria-hidden="true">
        ◇
      </span>
      <p className="wt-state__title">There is no page at this address</p>
      <p className="wt-state__hint">
        The link may be out of date, or the page may have moved. This response carries a 404
        status, so whatever sent you here can be fixed.
      </p>
      <div className="wt-state__action">
        <Link className="cf-btn" to="/">
          Back to the estate view
        </Link>
      </div>
    </div>
  )
}

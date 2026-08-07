/**
 * The boot sequence. The order is not arbitrary.
 *
 *   1. Observability first, so an exception thrown by anything below is reported rather than lost.
 *      A crash during the first render is the single most valuable event this app can send.
 *   2. Consent Mode, primed DENIED, before anything could conceivably arrive. See the note beside
 *      `initAnalytics()`.
 *   3. `bootstrapSession()` third, and AWAITED, so the SSO hand-off code in the URL fragment is
 *      redeemed before React mounts. It strips `#cf_code` from the address bar before the exchange
 *      goes over the wire — see the note in @cloudsforge/ui. Rendering first would show a
 *      signed-out shell to an operator who has just signed in, and would leave the code on screen
 *      for the length of a network round trip.
 *   4. Render last.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@cloudsforge/ui/tokens.css'
import '@cloudsforge/ui/ui.css'
import './styles.css'
import { initAnalytics } from '@cloudsforge/ui/consent'
import { App } from './app.tsx'
import { bootstrapSession } from './lib/api.ts'
import { initObs } from './lib/obs.ts'

initObs()

/*
 * Consent Mode is primed with every category DENIED before anything else runs — two pushes onto a
 * plain array, no request, no cookie, no script — and the analytics tag is loaded only if this
 * reader granted consent on a previous visit.
 *
 * ON THIS SURFACE IT CAN NEVER LOAD ONE AT ALL, and the call is still unconditional. `index.html`
 * carries no `cf-analytics` measurement ID, on purpose and at length — see the block in that file
 * — so `analyticsId()` is null, `grantConsent()` returns early and `CookieBanner` renders nothing.
 * What this call still buys is the denied default itself: if a tag ever arrives here by any route
 * — a browser extension, a future dependency, a mistake in a later edit — it arrives into a
 * dataLayer that has already refused storage, rather than into an empty one where the default is
 * granted. A default installed after a script has begun running is a race, and the losing branch
 * of that race sets a cookie.
 *
 * BEFORE `bootstrapSession()`, which is a network round trip, for the same reason it is before the
 * render: every window in which a tag could arrive with storage permitted by default is a window
 * this line exists to close.
 */
initAnalytics()

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

void bootstrapSession().finally(() => {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})

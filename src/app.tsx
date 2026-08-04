/**
 * The route table.
 *
 * Two facts about it are enforced elsewhere and must stay in agreement with it: `ROUTES` in
 * lib/routes.ts is the declaration the navigation is derived from, and nginx.conf enumerates the
 * same paths so that an address which is NOT here answers 404 rather than 200.
 *
 * ── Every route is behind the session gate, and that is not the security boundary ─────────────
 *
 * This console has no public page: every screen reads or writes something only an operator may
 * touch, and `admin-api` verifies the token and the `admin` role on the request itself
 * (`requireOperator`, admin-api/src/server.ts:496 — which also refuses a service token outright,
 * because approval is consent given by a person and a service is not a person). The gate here
 * exists so that a signed-out operator is sent to sign in instead of being shown a screen made
 * entirely of 401s.
 *
 * ── The origin check in front of everything ───────────────────────────────────────────────────
 *
 * If this bundle is ever served from a PUBLIC origin — any product, Hub, the site, the status
 * page, the account portal — it renders a refusal instead of the console. See
 * `servedFromPublicOrigin` in lib/hosts.ts for why that is worth a whole screen, and the README
 * for what the gateway must enforce in front of it.
 */
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/shell.tsx'
import { ForesightSection } from './components/foresight-section.tsx'
import { AuthProvider, ProtectedRoute } from './lib/auth.tsx'
import { currentPlacement } from './lib/hosts.ts'
import { ActionsPage } from './pages/actions.tsx'
import { ApprovalPage } from './pages/approval.tsx'
import { ApprovalsPage } from './pages/approvals.tsx'
import { AuditPage } from './pages/audit.tsx'
import { BroadcastsPage } from './pages/broadcasts.tsx'
import { EstatePage } from './pages/estate.tsx'
import { EngagementPage } from './pages/engagement.tsx'
import { FlagsPage } from './pages/flags.tsx'
import { NotFoundPage } from './pages/not-found.tsx'
import { SupportPage } from './pages/support.tsx'
import { CategoriesPage } from './pages/foresight/categories.tsx'
import { MarketPage } from './pages/foresight/market.tsx'
import { MarketsPage } from './pages/foresight/markets.tsx'
import { QueuePage } from './pages/foresight/queue.tsx'

export function App() {
  const placement = currentPlacement()
  if (placement === 'public-origin') return <MisplacedBundle />

  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<AppShell unregistered={placement === 'unregistered'} />}>
            <Route
              index
              element={
                <ProtectedRoute>
                  <EstatePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="approvals"
              element={
                <ProtectedRoute>
                  <ApprovalsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="approvals/:id"
              element={
                <ProtectedRoute>
                  <ApprovalPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="actions"
              element={
                <ProtectedRoute>
                  <ActionsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="audit"
              element={
                <ProtectedRoute>
                  <AuditPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="support"
              element={
                <ProtectedRoute>
                  <SupportPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="engagement"
              element={
                <ProtectedRoute>
                  <EngagementPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="flags"
              element={
                <ProtectedRoute>
                  <FlagsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="broadcasts"
              element={
                <ProtectedRoute>
                  <BroadcastsPage />
                </ProtectedRoute>
              }
            />
            {/*
              ── The Foresight operator panel, folded in at P13 ──────────────────────────────

              A NESTED route, so `ForesightSection` renders the section's own navigation once and
              the four screens render into its outlet — rather than four sibling routes each
              re-rendering the same nav.

              **Every one of them is individually behind `ProtectedRoute`, and the layout is too.**
              Wrapping only the layout would look sufficient and would not be: the gate decides
              what to RENDER, and a child route renders inside a parent that has already returned
              its children. Wrapping only the children would leave the section's nav visible to a
              signed-out browser. Neither is a security boundary in any case — foresight verifies
              the token and the `admin` role on every one of these routes itself, in
              `requireAdmin(await authenticate(...))` at foresight/src/server.ts:649, 660, 681,
              704, 714, 732, 772, 859, 899, 927, 957 and 976 — but a console that shows a
              signed-out operator a screen made entirely of 401s has failed at its own job.
            */}
            <Route
              path="foresight"
              element={
                <ProtectedRoute>
                  <ForesightSection />
                </ProtectedRoute>
              }
            >
              <Route
                index
                element={
                  <ProtectedRoute>
                    <QueuePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="markets"
                element={
                  <ProtectedRoute>
                    <MarketsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="markets/:id"
                element={
                  <ProtectedRoute>
                    <MarketPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="categories"
                element={
                  <ProtectedRoute>
                    <CategoriesPage />
                  </ProtectedRoute>
                }
              />
              {/* An unknown address under /foresight is still an unknown address. Without this it
                  would match the section index and quietly render the idea queue at, say,
                  /foresight/marketz — a 200 for a route that does not exist, which is the whole
                  thing nginx.conf's enumeration exists to prevent, reintroduced in the router. */}
              <Route path="*" element={<NotFoundPage />} />
            </Route>
            {/* Unknown paths render inside the shell, so the operator keeps the navigation they
                need to get back out — under a real 404, which nginx.conf preserves. */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

/**
 * The console refuses to run here.
 *
 * Deliberately not a banner over a working app. An operator console reachable from an origin
 * every member of the public already has open is the thing this repository exists to prevent, and
 * a dismissible warning is a warning that gets dismissed.
 */
function MisplacedBundle() {
  return (
    <main className="wt-main">
      <div className="wt-state wt-state--forbidden" role="alert">
        <span className="wt-state__icon" aria-hidden="true">
          ⊘
        </span>
        <p className="wt-state__title">
          This operator console is not being served from its own address
        </p>
        <p className="wt-state__hint">
          The CloudsForge operator console is a separate bundle on a separate host, on purpose: an
          operator interface must not share an origin with an unauthenticated public page, because
          a public page on the operator’s origin can read whatever that origin can. It has not been
          started, and it will not be until it is served from{' '}
          <code className="cf-num">admin</code>’s own address behind the gateway rule that keeps it
          off the public internet.
        </p>
        {/*
          Two situations reach this screen and the reader cannot tell them apart from the address
          bar alone, so both are named. An unknown hostname resolves as its own apex — which is
          also the marketing site's origin, because the site's subdomain is the empty string — so
          a preview deployment lands here too. Refusing is right in that case as well: at an
          address the registry does not know, this bundle would look for admin-api one level too
          deep and could not sign anybody in.
        */}
        <p className="wt-state__hint">
          Either this is a public surface’s origin, or it is an address the surface registry does
          not know — in which case every CloudsForge host derived from it, including{' '}
          <code className="cf-num">admin-api</code> and the account portal, points somewhere that
          does not exist. Neither is a state the console can work in.
        </p>
      </div>
    </main>
  )
}

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
 * (`requireOperator`, admin-api/src/server.ts:443 — which also refuses a service token outright,
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

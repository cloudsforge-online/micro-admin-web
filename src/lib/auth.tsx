/**
 * Session state for the tree, the gate in front of every route, and WHO THE OPERATOR IS.
 *
 * Hiding a route is NOT the security boundary — `admin-api` verifies the token and the `admin`
 * role on the request itself (`requireOperator`, admin-api/src/server.ts:443, which also refuses
 * a service token outright). This exists so that a signed-out operator is sent to sign in instead
 * of being shown a screen made entirely of 401s, and so that the console knows which principal it
 * is acting as.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **THE OPERATOR'S OWN PRINCIPAL IS READ FROM THE SESSION, NEVER TYPED, NEVER PASSED.**
 *
 * `admin-api` derives the actor from the verified bearer on every mutating route; `actor` is
 * never a body field, never a query parameter and never a header (the file header of
 * admin-api/src/server.ts states this as the service's first rule). So this value is used for
 * exactly one thing: deciding what the UI may OFFER. The four-eyes control — the requester may
 * not be the approver — is enforced three times in `admin-api`
 * (admin-api/src/approvals.ts:5-20: the route, the UPDATE's WHERE clause, and a CHECK
 * constraint), and this console's job is to make it LEGIBLE rather than to enforce it. An
 * operator who is shown an Approve button that will answer 403 has been told something false
 * about what is possible.
 *
 * The principal is `user:<uuid>`, matching `approvals.requested_by` and `audit_events.actor`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── The `/auth/me` shape, read correctly ──────────────────────────────────────────────────────
 *
 * Identity answers `{ user: {...}, session: {...}, organisations: [...] }` — the profile is
 * NESTED under `user` (`identity/src/server.ts:891-903`, with the body built by `toPublicUser` at
 * `identity/src/users.ts:52-63`). The web template and the four frontends cut from it declare
 * `interface Me { handle?, roles? }` and read those fields off the TOP level, where they do not
 * exist. The consequence is not cosmetic: `roles` is then always null, `isAdmin` in the company
 * bar is always false, and the switcher hides the three `adminOnly` entries — including this
 * console — from every operator who is signed in. Reported to `micro-web-template`; read
 * correctly here, with the fallback kept so an older or proxied shape still signs somebody in.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import type { AccountState } from '@cloudsforge/ui'
import { AUTH_EXPIRED_EVENT, clearTokens, hasSession, nimbus, signIn, signOut } from './api.ts'

/** The role `admin-api` requires on every route in this console. */
export const OPERATOR_ROLE = 'admin'

/** What identity answers at `/auth/me`, narrowed to what this console needs. */
export interface MeResponse {
  user?: {
    id?: string | null
    handle?: string | null
    roles?: readonly string[] | null
  } | null
  /** The flat shape a proxy or an older build may still answer. */
  handle?: string | null
  roles?: readonly string[] | null
  id?: string | null
}

export interface Operator {
  /** `user:<uuid>` — the principal `admin-api` records as the actor. Null when unknown. */
  readonly principal: string | null
  readonly handle: string | null
  readonly roles: readonly string[]
  /** True when the token carries the role every route in this console requires. */
  readonly isOperator: boolean
}

/**
 * Read the operator out of an `/auth/me` body.
 *
 * A pure function so `test/auth.test.ts` can prove both shapes without a browser, and so the
 * nested-versus-flat mistake cannot be made silently a second time.
 *
 * `principal` is null rather than a guess when there is no id: the console uses it to decide
 * whether the signed-in operator raised a request, and guessing would either offer a button that
 * 403s or hide one that would have worked. Null renders as "cannot tell", which is honest.
 */
export function readOperator(body: unknown): Operator {
  const empty: Operator = { principal: null, handle: null, roles: [], isOperator: false }
  if (typeof body !== 'object' || body === null) return empty
  const top = body as MeResponse
  const nested = typeof top.user === 'object' && top.user !== null ? top.user : undefined

  const id = str(nested?.id) ?? str(top.id)
  const handle = str(nested?.handle) ?? str(top.handle) ?? null
  const roles = list(nested?.roles) ?? list(top.roles) ?? []

  return {
    principal: id === undefined ? null : `user:${id}`,
    handle,
    roles,
    isOperator: roles.includes(OPERATOR_ROLE),
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function list(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((v): v is string => typeof v === 'string')
}

export type SessionStatus = 'loading' | 'anonymous' | 'signedIn'

export interface Session {
  status: SessionStatus
  account: AccountState
  operator: Operator
  signIn: (returnTo?: string) => void
  signOut: () => void
}

const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const value = useContext(SessionContext)
  // Throwing beats returning a signed-out default: a component rendered outside the provider
  // would otherwise show an anonymous UI to a signed-in operator and nobody would ever see why.
  if (!value) throw new Error('useSession must be used inside <AuthProvider>')
  return value
}

const NOBODY: Operator = { principal: null, handle: null, roles: [], isOperator: false }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>(() => (hasSession() ? 'loading' : 'anonymous'))
  const [operator, setOperator] = useState<Operator>(NOBODY)

  useEffect(() => {
    if (!hasSession()) return
    let live = true
    // The identity call is the one request that is allowed to fail quietly: an unreachable
    // account service must not sign an operator out mid-incident — that is the cascade the
    // estate's readiness rules exist to avoid. The console then cannot tell who is signed in, and
    // says so where it matters rather than guessing.
    nimbus<unknown>('/auth/me')
      .then((profile) => {
        if (!live) return
        setOperator(readOperator(profile))
        setStatus('signedIn')
      })
      .catch(() => {
        if (!live) return
        setStatus(hasSession() ? 'signedIn' : 'anonymous')
      })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const onExpired = () => {
      clearTokens()
      setOperator(NOBODY)
      setStatus('anonymous')
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  }, [])

  const doSignOut = useCallback(() => {
    setOperator(NOBODY)
    setStatus('anonymous')
    signOut()
  }, [])

  const value = useMemo<Session>(
    () => ({
      status,
      account: {
        signedIn: status === 'signedIn',
        handle: operator.handle,
        roles: operator.roles,
      },
      operator,
      signIn,
      signOut: doSignOut,
    }),
    [status, operator, doSignOut],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

/**
 * Gate a route behind a session.
 *
 * The redirect carries the CURRENT path, search and hash, so an operator who followed a link to a
 * deep page lands back on that page rather than on the estate view. It is fired from an effect
 * rather than during render because a redirect during render runs twice under StrictMode, and the
 * second one would overwrite the first's return address.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status, signIn: go } = useSession()
  const location = useLocation()

  useEffect(() => {
    if (status !== 'anonymous') return
    const back = `${window.location.origin}${location.pathname}${location.search}${location.hash}`
    go(back)
  }, [status, location.pathname, location.search, location.hash, go])

  if (status === 'loading') return <LoadingGate label="Checking your session" />
  if (status === 'anonymous') return <LoadingGate label="Taking you to sign in" />
  return <>{children}</>
}

function LoadingGate({ label }: { label: string }) {
  return (
    <div className="wt-state wt-state--loading" role="status">
      <span className="wt-spinner" aria-hidden="true" />
      <p className="wt-state__title">{label}</p>
    </div>
  )
}

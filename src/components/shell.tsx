/**
 * The app shell: the company bar, the operator navigation, and the page.
 *
 * The bar is `CloudsForgeBar` from @cloudsforge/ui and is never reimplemented. It is passed
 * `PRODUCT` — 'admin' — so the switcher marks this console as current and leaves every product
 * clickable, which is what an operator wants when they need to look at the public page of the
 * thing they are about to act on.
 *
 * The bar's right slot carries a permanent OPERATOR marker. It is a word and a border, never a
 * colour alone: Admin's clay (#c2704f) is a warm mid-tone that has no reserved meaning in this
 * estate, and nothing in this console may depend on the accent to say what it is.
 */
import { CloudsForgeBar } from '@cloudsforge/ui'
import { NavLink, Outlet } from 'react-router-dom'
import { PRODUCT } from '../lib/hosts.ts'
import { NAV } from '../lib/routes.ts'
import { useSession } from '../lib/auth.tsx'

export function AppShell({ unregistered = false }: { unregistered?: boolean }) {
  const { account, operator, signIn, signOut } = useSession()

  return (
    <>
      {/* Skip link first in the DOM, because keyboard is the primary input for an operator
          working through a queue and a console with six nav entries is six tabs to the content. */}
      <a className="aw-skip" href="#main">
        Skip to the page
      </a>
      <CloudsForgeBar
        current={PRODUCT}
        account={account}
        onSignIn={() => signIn()}
        onSignOut={signOut}
        rightSlot={<span className="aw-opmark">Operator</span>}
      />
      {/*
        The sub-nav is sticky at exactly `var(--cf-bar-h)` — the bar's own height token, not a
        number copied out of it. When the bar's height changes, this moves with it.
      */}
      <nav className="wt-subnav" aria-label="Sections">
        <div className="wt-subnav__inner">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `wt-subnav__link${isActive ? ' is-active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className="wt-main" id="main">
        {/*
          Not fatal, so not a refusal — but not silent either. `cloudsforgeHosts()` derives the
          apex by stripping a KNOWN subdomain, so an address the registry does not know makes every
          estate URL resolve one level too deep: `admin-api`, and the account portal with it. The
          symptom is a console that cannot sign anybody in and says nothing about why.
        */}
        {unregistered && (
          <p className="aw-note aw-note--warn" role="status">
            <span className="aw-note__icon" aria-hidden="true">
              ▲
            </span>
            This console is being served from an address the surface registry does not know, so
            every CloudsForge host it resolves — including the account portal — is derived from the
            wrong apex. Its home is the <code className="cf-num">admin</code> surface.
          </p>
        )}
        {/*
          The console could not establish which principal is signed in, which matters here in a way
          it does not elsewhere: the four-eyes control turns on it. Said once, at the top, rather
          than repeated on every request. See lib/auth.tsx.
        */}
        {operator.principal === null && account.signedIn && (
          <p className="aw-note aw-note--warn" role="status">
            <span className="aw-note__icon" aria-hidden="true">
              ▲
            </span>
            This console could not read your account profile, so it does not know which operator
            you are. It will still offer decisions, because refusing on a guess would block a
            legitimate approver — but admin-api is the thing that will refuse a self-approval, and
            you will find out at the request rather than before it.
          </p>
        )}
        <Outlet />
      </main>
    </>
  )
}

# micro-admin-web

The CloudsForge **operator console**. The estate view, the two-operator approval queue, the
tamper-evident audit and its chain verification, feature flags and estate-wide broadcasts.

It is the browser half of `micro-admin-api`. It holds no state of its own, decides nothing, and
enforces nothing: `admin-api` verifies the token and the `admin` role on every request
(`requireOperator`, `admin-api/src/server.ts:443`), refuses a service token outright, and enforces
the four-eyes control three separate times. **This console's job is to make all of that legible.**

---

## What the gateway must enforce

**This console must never be reachable from a public origin.** Nothing in this repository can make
that true — it serves static files and has no view of who is asking — so it is written down here,
and the bundle checks what it can at runtime as a second line.

The gateway must:

1. **Serve `admin-web` only on `admin.<apex>`, and serve nothing else there.** An operator UI must
   not share an origin with an unauthenticated public page (19-new-products.md:142): a public page
   on the operator's origin can read whatever that origin can. `src/lib/hosts.ts` refuses to render
   the console at all if it is ever served from a product origin, Forge Hub, the marketing site,
   the status page, the explorer, the developer platform or the account portal.
2. **Restrict `admin.<apex>` to the operator network** — a VPN, an identity-aware proxy, or an
   allowlist. Not "authenticated": *reachable only from where operators are*. Every other rule in
   this list assumes an attacker cannot open the page at all.
3. **Require MFA for the `admin` role** (SD-13, and 12-security-decisions.md:57 makes it mandatory
   for accounts holding it). The console cannot check this; the token issuer must.
4. **Keep refusing `/internal` from outside**, at the priority
   `deploy/gateway/dynamic/policy.yml` already gives it. Those routes take a `userId` as a
   parameter, which is an act-as-anyone primitive. Nothing in this console has an equivalent and
   nothing in `admin-api` does either, but the refusal is what stops one being reintroduced
   elsewhere.
5. **Not list `admin.<apex>` in any public CORS allowlist as an ORIGIN THAT MAY BE CALLED.** It is
   already in the estate's `accessControlAllowOriginList` as a caller, which is correct — this
   console calls other services' APIs. It must never be a target.
6. **Send `X-Frame-Options: DENY` / a frame-ancestors policy of `'none'` for this host.**
   `nginx.conf` already does; the gateway must not relax it. An operator console inside a frame is
   a clickjacking surface for a session that can authorise a ledger reversal.
7. **Not cache anything from this host.** `admin-api` sends `cache-control: no-store` on every
   response for a stated reason: acting on a ninety-second-old "ledger: ok" is acting on a fact
   that has changed. `nginx.conf` does the same for the shell.

The console's own defences, for completeness: `noindex` in a meta tag and in an `X-Robots-Tag`
header; a runtime refusal to render on a public origin; and no route in the client that can act as
somebody other than the signed-in operator.

---

## The action that cannot be executed — §3.3g

`GET /v1/actions` returns four catalogue entries. Three have an upstream route. **One does not**,
and how this console renders it is the most important design decision in the repository.

`identity.role.grant` — granting a platform role — is a first-class action with full authorisation
machinery behind it and **no executor**, because identity has no route that assigns `users.roles`.
`POST /v1/approvals` for it answers **`501 action_has_no_upstream`**, naming the route identity
would need. The reason it is refused rather than queued is at `admin-api/src/server.ts:657-659`: a
queue that accepts work it cannot do lies to the operator waiting on it, and leaves a row at
`approved` for ever — which reads in the audit as two operators having authorised something that
never happened.

**On `/actions` this renders as a section of its own, with no control in it.** Not a disabled
button: a disabled control reads as "not yet, ask someone", gets clicked at, and eventually
teaches the operator that the console is broken. The absence of a control, with a paragraph in its
place, reads as "the estate has decided this cannot be done from here, and here is what would have
to exist". The paragraph is `admin-api`'s own `blockedReason` string, verbatim — the same string
the 501 carries — so the console and the service cannot drift into telling two different stories.

Three properties, each a test in `test/catalogue.test.ts`:

* The blocked action is **listed**, never hidden. A gap nobody can find is a gap nobody closes.
* No control exists that could send the request. `mayRequest()` is a pure function both the form
  and its button read, so the two cannot disagree.
* Availability turns on **`spec.route === null`** — the same predicate the service uses — and never
  on the action's name. The day identity grows
  `PUT /internal/users/:id/roles` behind a service token holding `identity:admin`, `admin-api`
  fills in `route` and the action becomes requestable here **with no change to this repository**.

The 501 is also handled when it arrives anyway, because a catalogue read thirty seconds ago is a
claim about the past. It renders as the catalogue's sentence, not as a server error worth retrying.

**The bootstrap stays outside every service.** A service that can mint its own first administrator
is a service whose compromise grants the estate, and this queue could not authorise the first
grant anyway — approving requires an operator who already holds the role. The first admin is a
documented `update users set roles = array['admin']` under the database owner's credentials, which
`scripts/slice-verify.sh` performs and asserts.

---

## What folds in at P13

`micro-foresight-admin-web` — the Forge Foresight operator panel: the idea queue, market lifecycle,
resolution and void. 19-new-products.md:142 and :210 both say so: "kept as its own small surface
for now and folded into `admin-web` (P13) when that exists".

This console is built for it to fold *into*:

| What foresight-admin-web has | Where it lands here |
| --- | --- |
| `IrreversibleAction` — consequences in sentences, a rationale, a typed phrase | `src/components/irreversible.tsx`, same shape, plus the audit-row preview this console adds |
| `confirmationGate` / `confirmationPhrase` | `src/lib/gate.ts`, same signature, phrase generalised from market+outcome to request+outcome |
| Its own `states.tsx`, `resource.ts`, `mutation.ts`, `obs.ts`, `api.ts` | Identical files; they are the shared layer and merge without conflict |
| Its route table in `lib/routes.ts` + nginx enumeration | Add `foresight` (wildcard) to `ROUTES` and to the `location ~ ^/(…)` block; `test/routes.test.ts` fails until both are done |
| `BAR_SURFACE = 'admin'` | Already this console's `PRODUCT`. It has been taking this address on purpose, so the fold is a routing change rather than a migration |
| `API_SURFACE = 'foresight'` | Becomes a second host: this console calls `admin-api` same-origin and would call foresight cross-origin. `resolveApiBase` already takes a surface key per call |

The one thing that does **not** fold cleanly: foresight-admin-web reads `/auth/me` in the flat
shape (see below), so its `auth.tsx` is dropped in favour of this one rather than merged.

---

## Screens

| Route | What it answers | Routes called |
| --- | --- | --- |
| `/` | Is anything wrong? | `GET /v1/estate` |
| `/approvals` | What is waiting for a second operator? | `GET /v1/approvals` |
| `/approvals/:id` | Should I approve this, and what will it record? | `GET /v1/approvals/:id`, `POST /v1/approvals/:id/decision` |
| `/actions` | What can be asked for — and what cannot | `GET /v1/actions`, `POST /v1/approvals` |
| `/audit` | What happened, and does the chain hold? | `GET /v1/audit`, `GET /v1/audit/verify` |
| `/flags` | What is switched on | `GET /v1/flags`, `PUT /v1/flags/:key` |
| `/broadcasts` | What the estate is telling everyone | `GET /v1/broadcasts`, `POST /v1/broadcasts`, `DELETE /v1/broadcasts/:id` |

Every call carries the `admin-api/src/server.ts` line it was verified against, in a comment beside
it in `src/lib/admin.ts`. `test/admin.test.ts` asserts the method, path, query, body and headers of
every one, and that the set of paths exercised is exactly the set declared.

**`POST /v1/events` is never called.** It is the estate's audit mirror intake: signature-checked
against `OUTBOX_SIGNING_SECRET` over the exact bytes received, before the body is parsed, and the
bearer must hold the exact `admin:audit:write` scope. A browser holds neither, and a console that
appeared to offer it would be offering a forgery endpoint for the record disputes are settled
against. Its absence is asserted, in the test suite and again in CI.

---

## What makes this different from every other frontend in the estate

1. **Every action is audited, and the audit is the point.** Every write in this console shows the
   audit rows it will produce — actor, action, subject, outcome, reason code, in sentences —
   *above* the control, never below it and never behind a disclosure triangle. An operator signs
   for a record they have read.
2. **An operator acts as themselves, never as a user.** No function in `src/lib/admin.ts` takes an
   actor, an operator or a `userId`; `admin-api` derives every actor from the verified bearer. A
   user is a *subject*, never a costume. Asserted by test and by a CI grep.
3. **The four-eyes control is legible.** When the signed-in operator raised the request, the
   decision controls are replaced by a sentence naming that fact and the three places `admin-api`
   refuses it — not a disabled button.
4. **Irreversible actions are legible, not fast.** Consequences in sentences, then the audit
   preview, then a required rationale, then a phrase naming the request and the outcome
   (`approve 3f2a1b9c ledger.entry.reverse`). Never "Are you sure?".
5. **Missing is missing.** `trialBalance.balanced` and `openModerationCases.count` are `null` when
   their upstream failed. Neither renders as `0` or `true`, anywhere.
6. **Degradation, not blank pages.** A dead upstream marks one tile, names its upstream and its
   reason, and every other tile is still OK — both halves are asserted.

---

## Brand chrome, and the og card that is deliberately absent

`public/` holds the three favicons from `brand/assets/admin/`, byte-identical, linked in
`index.html` in both directions.

**There is no `og` card, and that is the asset set's own decision.** 18-build-status.md **§3.3k**
audited all fourteen planned frontends against the brand sets and records it in one line: `admin`
deliberately has none, because nobody shares an operator console outward and a card there would
exist to satisfy a pattern rather than a need. (`developers` gained one in the same pass, because
devportal-web is public and its links do get shared.)

`micro-web-template/test/brand-chrome.test.ts` requires an `og:image`. That requirement is right
for every surface it was written for and this is the one place it does not fit. This repository
did **not** generate an asset to satisfy it and did **not** delete the check. `test/brand-chrome.test.ts`
here keeps both favicon checks verbatim, in both directions, adds a byte-comparison against the
brand source, and replaces the three og tests with three that assert the deliberate **absence**
with the same force — so adding an og card to this console later fails the build and has to be
argued for. The full argument is in that file's header.

---

## Running it

```
pnpm install          # needs ../ui checked out as a sibling
pnpm typecheck
pnpm test
pnpm build
pnpm dev              # http://localhost:5183
```

**A local wrinkle that has since been fixed upstream.** The surface registry used to give `admin`
devPort **3002** while `admin-api` binds **4014** (`admin-api/src/env.ts:167`,
`admin-api/.env.example:76`), so `pnpm dev` resolved to a port with nothing on it. Production hid
it — the console and its API share an origin behind `admin.<apex>`, so every request is relative.

This repository refused to paper over it with a literal port, because a hard-coded host is a
second, unversioned copy of the registry and the copy is the one that goes stale. It was reported
to `micro-ui` and corrected there: the registry now says 4014, and `surfaces.test.ts` pins that
value against the service with its citation instead of only checking that it collides with nothing
— which is precisely why three wrong ports got through before it.

### The image

```
docker build -t admin-web --build-context uipkg=../ui .
docker run --rm -p 55640:8080 admin-web
```

`Dockerfile` copies `public/` into the build context, which **the web template's does not** — Vite
copies `publicDir` at build time, so without that line the built image has no favicon in it while
the brand test passes against the source tree. Reported to `micro-web-template`; pinned here by
`test/brand-chrome.test.ts` and probed again in CI against the running container.

---

## Defects found in repositories this one does not own

Reported, not fixed.

| Where | What |
| --- | --- |
| ~~`micro-web-template`, and `hub-web`, `site`, `foresight-web`, `foresight-admin-web`~~ **fixed** — and `emberkin-web`, which the original report missed | `src/lib/auth.tsx` declared `interface Me { handle?, roles? }` and reads them off the top level of `/auth/me`. Identity nests them under `user` (`identity/src/server.ts:891-903`, `identity/src/users.ts:52-63`). `roles` is therefore always null, `isAdmin` in the company bar is always false, and the switcher hides the three `adminOnly` entries — including this console — from every signed-in operator. Read correctly here; see `src/lib/auth.tsx` and `test/auth.test.ts`. |
| ~~`micro-web-template`~~ **fixed**, along with `market-web`, `foresight-web`, `foresight-admin-web` and `status-web`, which were the ones actually affected | The `Dockerfile` never copied `public/` into the build context, so `dist/` in the built image contains no favicon. `test/brand-chrome.test.ts` reads the source tree and passes regardless. §3.3e one layer down. |
| ~~`micro-ui`~~ **fixed** | `surfaces.ts` gave `admin` devPort 3002; `admin-api` binds 4014. Production is unaffected (same origin); `pnpm dev` resolves to a port with nothing on it. The same class as the foresight 4021/4011 collision that repository already fixed once. |

Nothing was found wrong in `admin-api` itself. Two things about it are worth stating positively,
because a reader may mistake them for gaps: `PUT /v1/flags/:key` and `DELETE /v1/broadcasts/:id`
take **no** `Idempotency-Key`, and both exemptions are recorded with their reasons in
`admin-api/src/routeidempotency.test.ts:32-39`. This client sends none for either, deliberately.

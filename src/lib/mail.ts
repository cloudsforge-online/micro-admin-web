/**
 * The operator mail view — "what did we send this person, and did it arrive".
 *
 * `GET /v1/mail` and `POST /v1/mail/:id/resend` — **admin-api/src/server.ts**, which forwards the
 * OPERATOR's own bearer to notify rather than minting a service token. That is why nothing here
 * carries a credential beyond what `api()` already attaches: the authorisation decision lives in
 * notify, against the human who is signed in to this console.
 *
 * One deliberate mirror of the API's own refusal: `loadMail` requires a user OR an address at the
 * type level. Unscoped, notify's underlying route is the estate-wide dead-letter view — a
 * different question — and admin-api answers 400 rather than serving it under this name. A UI
 * that could even ASK the unscoped question would render that 400 as a failure, so the type makes
 * the question unaskable instead.
 */

import { api } from './api.ts'
import { idempotencyKeyFor } from './gate.ts'

export interface MailDelivery {
  readonly id: string
  readonly userId: string
  readonly channel: string
  readonly state: 'pending' | 'sent' | 'dead' | 'undeliverable'
  readonly outcome: string
  readonly reason: string | null
  readonly attempts: number
  readonly maxAttempts: number
  readonly lastError: string | null
  readonly category: string
  readonly templateId: string
  readonly createdAt: string
  readonly sentAt: string | null
}

export type MailQuery =
  | { readonly user: string; readonly address?: undefined }
  | { readonly address: string; readonly user?: undefined }

export function loadMail(
  query: MailQuery,
  opts: { signal?: AbortSignal } = {},
): Promise<{ deliveries: readonly MailDelivery[]; nextCursor: string | null }> {
  return api('/v1/mail', {
    ...(opts.signal ? { signal: opts.signal } : {}),
    query: {
      ...(query.user ? { user: query.user } : {}),
      ...(query.address ? { address: query.address } : {}),
      limit: 100,
    },
  })
}

/**
 * Queue the same notification again, as a NEW delivery beside the original.
 *
 * 202: nothing has been sent when this resolves — notify's dispatcher takes the row on its own
 * schedule. The page renders "queued", never "sent", for exactly that reason.
 *
 * The idempotency key is keyed on the delivery id and the page view (`mintedAt`), matching how
 * the broadcast composer keys on its title: a double click inside one view is one send, and a
 * deliberate second resend after a reload is a new decision with a new key.
 */
export function resendMail(deliveryId: string, mintedAt: number): Promise<{ deliveryId: string }> {
  return api(`/v1/mail/${encodeURIComponent(deliveryId)}/resend`, {
    method: 'POST',
    body: {},
    headers: { 'idempotency-key': idempotencyKeyFor('mail-resend', deliveryId, mintedAt) },
  })
}

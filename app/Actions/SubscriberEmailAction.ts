import Subscriber from '../Models/Subscriber'

export interface SubscribeResult {
  success: boolean
  message: string
}

export interface SubscribeAction {
  name: string
  method: 'POST'
  handle: (params: Record<string, string>) => Promise<SubscribeResult>
}

// One @, a dot in the domain, no whitespace — matches the model's
// schema.string().email() closely enough for a signup form.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * SubscriberEmailAction — store a newsletter signup from the marketing page's
 * "notify me when it hits the stores" form. Mirrors the Stacks framework's
 * default action (validate → dedupe → create) and writes through the app's own
 * Subscriber model (app/Models/Subscriber.ts), i.e. the real ORM.
 *
 * Kept as a plain handler rather than a `@stacksjs/actions` Action so it runs in
 * the lean server (server/serve.ts) without booting the framework's feature
 * system — the ORM model still does the actual persistence.
 */
export async function handle(params: Record<string, string>): Promise<SubscribeResult> {
  const email = (params.email || '').trim().toLowerCase()
  const source = (params.source || 'homepage').slice(0, 100)

  if (!email || email.length > 255 || !EMAIL_RE.test(email))
    return { success: false, message: 'Please enter a valid email address.' }

  if (await Subscriber.where('email', email).first())
    return { success: true, message: 'Already subscribed' }

  // The check above is a fast path; concurrent signups for the same email can
  // both pass it and race into the UNIQUE index. Treat the loser's violation as
  // the same "already subscribed" success.
  try {
    await Subscriber.create({ email, status: 'subscribed', source })
  }
  catch (err) {
    if (String(err).includes('UNIQUE'))
      return { success: true, message: 'Already subscribed' }
    throw err
  }

  return { success: true, message: 'Subscribed' }
}

const SubscriberEmailAction: SubscribeAction = { name: 'SubscriberEmailAction', method: 'POST', handle }
export default SubscriberEmailAction

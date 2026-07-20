import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import Subscriber from '../Models/Subscriber'

export interface SubscribeResult {
  success: boolean
  message: string
}

// One @, a dot in the domain, no whitespace — matches the model's
// schema.string().email() closely enough for a signup form.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Store a newsletter signup from the marketing page. Exported separately from
 * the Action adapter so the persistence contract remains easy to test.
 */
export async function subscribe(params: Record<string, string>): Promise<SubscribeResult> {
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

const SubscriberEmailAction: Action = new Action({
  name: 'SubscriberEmailAction',
  description: 'Store a Very Good AdBlock newsletter subscription',
  method: 'POST',
  skipCsrf: true,
  async handle(request: RequestInstance) {
    return await subscribe({
      email: String(request.get('email') ?? ''),
      source: String(request.get('source') ?? 'homepage'),
    })
  },
})

export default SubscriberEmailAction

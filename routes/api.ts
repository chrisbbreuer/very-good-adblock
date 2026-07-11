import type { SubscribeResult } from '../app/Actions/SubscriberEmailAction'
import { handle as subscriberEmail } from '../app/Actions/SubscriberEmailAction'

export type RouteHandler = (params: Record<string, string>) => Promise<SubscribeResult>

export interface ApiRoute {
  method: 'POST'
  path: string
  handler: RouteHandler
}

/**
 * API routes. Mirrors a Stacks routes/api.ts — the marketing subscribe form
 * POSTs to /api/email/subscribe, mapped to the SubscriberEmailAction. The lean
 * server (server/serve.ts) reads this table and dispatches to the handler.
 */
export const routes: ApiRoute[] = [
  { method: 'POST', path: '/api/email/subscribe', handler: subscriberEmail },
]

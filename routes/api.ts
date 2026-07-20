import { response, route } from '@stacksjs/router'

// app/Routes.ts applies the /api prefix for this file.
route.get('/health', () => response.json({ ok: true }))

route
  .post('/email/subscribe', 'Actions/SubscriberEmailAction')
  .name('email.subscribe')
  .rateLimit(10, 'minute')
  .skipCsrf()

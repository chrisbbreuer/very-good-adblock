/**
 * Marketing-page email capture. Progressive enhancement over a plain form that
 * already POSTs to the Stacks subscribe endpoint (SubscriberEmailAction → the
 * Subscriber model): intercept the submit, post via fetch, and show inline status
 * so the visitor never leaves the page. Without JS the form still submits.
 */
const form = document.getElementById('subscribe-form') as HTMLFormElement | null
const emailInput = document.getElementById('subscribe-email') as HTMLInputElement | null
const status = document.getElementById('subscribe-status')

function setStatus(message: string, kind: 'ok' | 'error' | 'pending'): void {
  if (!status) return
  status.textContent = message
  status.dataset.kind = kind
}

if (form && emailInput && status) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const email = emailInput.value.trim()
    if (!email || !email.includes('@')) {
      setStatus('Please enter a valid email address.', 'error')
      emailInput.focus()
      return
    }

    const button = form.querySelector('button')
    if (button) button.disabled = true
    setStatus('Subscribing...', 'pending')

    try {
      const body = new URLSearchParams({ email, source: 'verygoodadblock' })
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body,
      })
      const data = await response.json().catch(() => ({})) as { success?: boolean, message?: string }

      if (data.success) {
        setStatus(data.message === 'Already subscribed' ? 'You are already on the list.' : 'Done. Watch your inbox to confirm.', 'ok')
        form.reset()
      }
      else {
        setStatus(data.message || 'Something went wrong. Please try again.', 'error')
      }
    }
    catch {
      setStatus('Network error. Please try again.', 'error')
    }
    finally {
      if (button) button.disabled = false
    }
  })
}

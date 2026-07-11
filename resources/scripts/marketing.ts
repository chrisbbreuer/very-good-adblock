/**
 * Marketing-page email capture. Progressive enhancement over a plain form that
 * POSTs same-origin to /api/email/subscribe (server/api.ts → project-owned
 * SQLite): intercept the submit, post via fetch, and show inline status so the
 * visitor never leaves the page. Without JS the form still submits.
 */
const form = document.getElementById('subscribe-form') as HTMLFormElement | null
const emailInput = document.getElementById('subscribe-email') as HTMLInputElement | null
const status = document.getElementById('subscribe-status')

// Light/dark theme. With no saved choice the CSS `prefers-color-scheme` media
// query drives it (no flash, follows the OS live); a saved choice pins an
// explicit `data-theme` override. The inline head script that would set this
// pre-paint is stripped from the built page by the CSP sanitizer, so re-apply
// any saved choice here.
function currentTheme(): 'light' | 'dark' {
  const explicit = document.documentElement.dataset.theme
  if (explicit === 'light' || explicit === 'dark') return explicit
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

try {
  const saved = localStorage.getItem('vga-theme')
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved
}
catch {
  // Storage unavailable — fall back to the system preference via CSS.
}

const themeToggle = document.getElementById('theme-toggle')
themeToggle?.addEventListener('click', () => {
  const next = currentTheme() === 'light' ? 'dark' : 'light'
  document.documentElement.dataset.theme = next
  try {
    localStorage.setItem('vga-theme', next)
  }
  catch {
    // Private mode / storage disabled — the toggle still works for this session.
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'light' ? '#fbf1f1' : '#100a0b')
})

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
        setStatus(data.message === 'Already subscribed' ? 'You are already on the list.' : 'You are on the list. We will only email you when it matters.', 'ok')
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

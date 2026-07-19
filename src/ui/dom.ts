import type { RuntimeMessage, RuntimeResponse } from '../shared/types'

export interface BarRenderOptions {
  interactive?: boolean
  valueLabel?: (value: number, index: number) => string
}

export function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing #${id}`)
  return element as T
}

export async function sendMessage<T>(message: RuntimeMessage): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as RuntimeResponse<T>
  if (!response.ok) throw new Error(response.error ?? 'Extension request failed')
  return response.data as T
}

export function renderBars(element: HTMLElement, values: number[], limit: number, options: BarRenderOptions = {}): void {
  // Scale to the window actually rendered, not the full series: when the
  // series' peak falls outside the visible window, scaling against it flattens
  // every visible bar into the minimum-height floor (the "dotted line" look).
  const start = Math.max(0, values.length - limit)
  const window_ = values.slice(start)
  const max = Math.max(0, ...window_)
  const fragment = document.createDocumentFragment()
  const padding = Math.max(0, limit - window_.length)

  for (let index = 0; index < padding; index++) {
    fragment.append(barElement(0, max, index, options))
  }

  for (let index = 0; index < window_.length; index++) {
    fragment.append(barElement(window_[index], max, padding + index, options))
  }

  element.replaceChildren(fragment)
  attachChartTooltip(element)
}

function barElement(value: number, max: number, index: number, options: BarRenderOptions): HTMLSpanElement {
  const bar = document.createElement('span')
  // Empty slots render as a faint baseline dash (styled in CSS), so hours with
  // nothing blocked read as empty instead of as small accent bars.
  if (value > 0 && max > 0) {
    // A 10% floor keeps small-but-nonzero hours visible next to a peak hour.
    bar.style.height = `${Math.max(10, Math.round((value / max) * 100))}%`
  }
  else {
    bar.dataset.empty = 'true'
  }
  const label = options.valueLabel?.(value, index) ?? `${value.toLocaleString()} blocked`
  bar.dataset.tooltip = label
  bar.setAttribute('aria-label', label)
  if (options.interactive) {
    bar.tabIndex = 0
    bar.role = 'listitem'
  }
  return bar
}

// A single tooltip element positioned relative to the viewport, so it always sits
// above every bar and panel and never gets clipped by a container's bounds — the
// pure-CSS `::after` tooltip lived inside a bar's stacking context and was hidden
// behind taller neighbouring bars, and clipped by the popup edge.
const wiredCharts = new WeakSet<HTMLElement>()
let chartTooltip: HTMLDivElement | undefined

function tooltipElement(): HTMLDivElement {
  if (!chartTooltip) {
    chartTooltip = document.createElement('div')
    chartTooltip.className = 'chart-tooltip'
    chartTooltip.setAttribute('role', 'tooltip')
    document.body.append(chartTooltip)
  }
  return chartTooltip
}

function attachChartTooltip(container: HTMLElement): void {
  if (wiredCharts.has(container)) return
  wiredCharts.add(container)

  const show = (target: EventTarget | null): void => {
    if (!(target instanceof HTMLElement) || !target.dataset.tooltip) return
    const tip = tooltipElement()
    tip.textContent = target.dataset.tooltip

    const bar = target.getBoundingClientRect()
    const size = tip.getBoundingClientRect()
    const margin = 6
    const left = Math.min(Math.max(margin, bar.left + bar.width / 2 - size.width / 2), window.innerWidth - size.width - margin)
    const top = Math.max(margin, bar.top - size.height - 8)
    tip.style.left = `${Math.round(left)}px`
    tip.style.top = `${Math.round(top)}px`
    tip.dataset.visible = 'true'
  }

  const hide = (): void => {
    if (chartTooltip) chartTooltip.dataset.visible = 'false'
  }

  container.addEventListener('pointerover', event => show(event.target))
  container.addEventListener('pointerout', hide)
  container.addEventListener('focusin', event => show(event.target))
  container.addEventListener('focusout', hide)
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

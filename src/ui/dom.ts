import type { RuntimeMessage, RuntimeResponse } from '../shared/types'

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

export function renderBars(element: HTMLElement, values: number[], limit: number): void {
  const max = Math.max(1, ...values)
  const fragment = document.createDocumentFragment()
  const start = Math.max(0, values.length - limit)
  const padding = Math.max(0, limit - (values.length - start))

  for (let index = 0; index < padding; index++) {
    fragment.append(barElement(0, max))
  }

  for (let index = start; index < values.length; index++) {
    fragment.append(barElement(values[index], max))
  }

  element.replaceChildren(fragment)
}

function barElement(value: number, max: number): HTMLSpanElement {
  const bar = document.createElement('span')
  bar.style.height = `${Math.max(6, Math.round((value / max) * 100))}%`
  bar.title = `${value} blocked`
  return bar
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

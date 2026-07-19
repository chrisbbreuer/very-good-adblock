/** Human label for a block-event source, shared by the popup and dashboard. */
export function sourceLabel(source: string): string | undefined {
  if (source === 'dnr') return 'Network rules'
  if (source === 'video') return 'Video skips'
  if (source === 'twitch') return 'Twitch banners'
  if (source === 'youtube') return 'YouTube placements'
  if (source === 'cosmetic') return 'Hidden placements'
  if (source === 'consent') return 'Cookie banners'
  if (source === 'popup') return 'Pop-ups'
  if (source === 'x') return 'X promoted'
  if (source === 'manual') return 'Manual rules'
  return undefined
}

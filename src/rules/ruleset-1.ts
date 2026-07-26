import { buildStaticRuleset } from './static-rules'

/**
 * Ruleset file 1 of the split static ruleset — see `rulesPerRuleset` for why
 * the rules are emitted across several files instead of one.
 */
export default function (): chrome.declarativeNetRequest.Rule[] {
  return buildStaticRuleset(0)
}

import { buildStaticRuleset } from './static-rules'

/**
 * Ruleset file 3 of the split static ruleset — see `rulesPerRuleset` for why
 * the rules are emitted across several files instead of one.
 */
export default function (): chrome.declarativeNetRequest.Rule[] {
  return buildStaticRuleset(2)
}

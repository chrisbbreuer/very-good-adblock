/**
 * The popup's "blocked on this page" number counts distinct ad and tracker
 * HOSTS, not blocked requests. This is the one decision behind that.
 *
 * A blocked tracker does not stop asking. Its script sees the request fail and
 * retries — often on a timer, often forever — so a single endpoint can be
 * refused hundreds of times while the page sits open. Counting requests made
 * an ordinary shop page report figures in the high hundreds within minutes,
 * which reads as an absurd number of ads rather than as one analytics script
 * failing over and over.
 *
 * The repeats are not hidden: they still move the raw counter behind the
 * bytes-saved estimate and the `×N` on the page's own row. Only the headline
 * counts each host once.
 */

/**
 * Record a blocked request against the hosts already counted this visit, and
 * report whether it is the first from that host — the only case that moves the
 * headline counter.
 *
 * A request with no host to attribute (a reconciled match whose URL the
 * browser did not report) returns false: an unattributable block cannot be
 * distinguished from a repeat, and guessing it is new is how the count inflates.
 *
 * Past `maxHosts` the counter stops rising rather than tracking a page whose
 * trackers randomise their subdomains. A number meaning "how many trackers are
 * on this page" is not improved by a thousandth entry.
 */
export function isNewBlockedHost(seen: Set<string>, host: string | undefined, maxHosts: number): boolean {
  if (!host) return false
  if (seen.has(host)) return false
  if (seen.size >= maxHosts) return false

  seen.add(host)
  return true
}

'use strict'

/**
 * Group invalid (or arbitrary) link findings for triage UI / JSON.
 *
 * Modes:
 * - byDestination: cluster rebrands / shared dead hosts
 * - bySourcePage: page-centric repair
 * - byStatus: 4xx / 5xx / timeout / dns / ssl / forbidden / other
 * - byHost: hostname buckets
 *
 * Default heuristic (chooseDefaultGrouping):
 * Prefer byDestination when many findings share hosts (rebrand / outage clusters);
 * otherwise bySourcePage.
 */

function hostOf (url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch (_) {
    return '(invalid-url)'
  }
}

function statusBucket (row) {
  const c = row.classification || 'other'
  if (c === '404' || c === 'forbidden' || c === 'timeout' || c === 'dns' || c === 'ssl') return c
  const status = row.status
  if (status == null) return c === 'ok' ? 'ok' : 'other'
  if (status >= 500) return '5xx'
  if (status >= 400) return '4xx'
  return c
}

function emptyGroup (key, label) {
  return { key, label: label || key, count: 0, items: [] }
}

function pushGroup (map, key, label, item) {
  if (!map.has(key)) map.set(key, emptyGroup(key, label))
  const g = map.get(key)
  g.items.push(item)
  g.count = g.items.length
}

function groupByDestination (rows) {
  const map = new Map()
  for (const r of rows) {
    pushGroup(map, r.url, r.url, r)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

function groupBySourcePage (rows) {
  const map = new Map()
  for (const r of rows) {
    const sources = (r.sources && r.sources.length) ? r.sources : ['(unknown)']
    for (const s of sources) {
      pushGroup(map, s, s, r)
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

function groupByStatus (rows) {
  const map = new Map()
  for (const r of rows) {
    const bucket = statusBucket(r)
    pushGroup(map, bucket, bucket, r)
  }
  const order = ['404', '4xx', 'forbidden', '5xx', 'timeout', 'dns', 'ssl', 'other', 'ok']
  return [...map.values()].sort((a, b) => {
    const ia = order.indexOf(a.key)
    const ib = order.indexOf(b.key)
    const sa = ia === -1 ? 99 : ia
    const sb = ib === -1 ? 99 : ib
    return sa - sb || b.count - a.count
  })
}

function groupByHost (rows) {
  const map = new Map()
  for (const r of rows) {
    const h = hostOf(r.url)
    pushGroup(map, h, h, r)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/**
 * Prefer destination grouping when shared-host clusters dominate
 * (typical rebrand / CDN outage). Threshold: any host with >= 3 findings,
 * or >= 3 findings total with the top host covering >= 40%.
 */
function chooseDefaultGrouping (rows) {
  if (!rows || rows.length < 2) return 'bySourcePage'
  const byHost = groupByHost(rows)
  if (!byHost.length) return 'bySourcePage'
  const top = byHost[0]
  const share = top.count / rows.length
  if (top.count >= 3 || (rows.length >= 3 && share >= 0.4)) return 'byDestination'
  return 'bySourcePage'
}

function buildGroupings (rows = [], { defaultMode } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const chosen = defaultMode || chooseDefaultGrouping(list)
  return {
    default: chosen,
    byDestination: groupByDestination(list),
    bySourcePage: groupBySourcePage(list),
    byStatus: groupByStatus(list),
    byHost: groupByHost(list),
  }
}

module.exports = {
  hostOf,
  statusBucket,
  groupByDestination,
  groupBySourcePage,
  groupByStatus,
  groupByHost,
  chooseDefaultGrouping,
  buildGroupings,
}

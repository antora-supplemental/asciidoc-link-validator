'use strict'

/**
 * Per-host concurrency and spacing defaults.
 *
 * Assumptions (documented in README):
 * - github.com / raw.githubusercontent.com web HEAD/GET without auth: ~60 requests/hour
 *   effective cap from shared egress — use concurrency 1 and ≥1100ms spacing (~55/hr).
 * - With GITHUB_TOKEN (Actions GITHUB_TOKEN or PAT): REST allows 5000/hr; web probes still
 *   benefit from modest concurrency — use 5 parallel and ~200ms spacing (~300/min ceiling).
 * - Other hosts: default concurrency 4, no extra spacing.
 */

const DEFAULT_HOST = {
  concurrency: 4,
  minIntervalMs: 0,
  maxRetries: 2,
  cacheMaxAgeMs: 24 * 60 * 60 * 1000,
}

const GITHUB_WEB_UNAUTH = {
  concurrency: 1,
  minIntervalMs: 1100,
  maxRetries: 5,
  cacheMaxAgeMs: 24 * 60 * 60 * 1000,
}

const GITHUB_WEB_AUTH = {
  concurrency: 5,
  minIntervalMs: 200,
  maxRetries: 5,
  cacheMaxAgeMs: 12 * 60 * 60 * 1000,
}

const GITHUB_API_AUTH = {
  concurrency: 8,
  minIntervalMs: 80,
  maxRetries: 5,
  cacheMaxAgeMs: 6 * 60 * 60 * 1000,
}

function isGitHubHost (hostname) {
  if (!hostname) return false
  const h = hostname.toLowerCase()
  return h === 'github.com' || h === 'www.github.com' ||
    h === 'raw.githubusercontent.com' || h === 'api.github.com'
}

function resolveHostPolicy (urlString, { githubToken = null } = {}) {
  let hostname
  try {
    hostname = new URL(urlString).hostname.toLowerCase()
  } catch {
    return { ...DEFAULT_HOST, hostname: null }
  }

  if (hostname === 'api.github.com') {
    return githubToken
      ? { ...GITHUB_API_AUTH, hostname }
      : { ...GITHUB_WEB_UNAUTH, hostname, concurrency: 2, minIntervalMs: 600 }
  }

  if (hostname === 'github.com' || hostname === 'www.github.com' ||
      hostname === 'raw.githubusercontent.com') {
    return githubToken
      ? { ...GITHUB_WEB_AUTH, hostname }
      : { ...GITHUB_WEB_UNAUTH, hostname }
  }

  return { ...DEFAULT_HOST, hostname }
}

function resolveGlobalConcurrency (entries, { githubToken = null, override = null } = {}) {
  if (override != null && Number.isFinite(Number(override))) {
    return Math.max(1, Number(override))
  }
  const hasGitHub = entries.some((e) => {
    const u = typeof e === 'string' ? e : e.url
    try { return isGitHubHost(new URL(u).hostname) } catch { return false }
  })
  if (hasGitHub && !githubToken) return 2
  if (hasGitHub && githubToken) return 6
  return DEFAULT_HOST.concurrency
}

module.exports = {
  DEFAULT_HOST,
  GITHUB_WEB_UNAUTH,
  GITHUB_WEB_AUTH,
  isGitHubHost,
  resolveHostPolicy,
  resolveGlobalConcurrency,
}

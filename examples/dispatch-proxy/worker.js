'use strict'

/**
 * Cloudflare Workers variant of the dispatch + probe proxy.
 * Bind secrets: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO
 * Optional vars: WORKFLOW_ID, WORKFLOW_REF, STATUS_ARTIFACT_URL, PROBE_ALLOWLIST, CORS_ORIGIN
 */

const DEFAULT_WORKFLOW = 'link-validator-writeback.yml'

function corsHeaders (origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

async function dispatch (env, body) {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN
  const owner = env.GITHUB_OWNER
  const repo = env.GITHUB_REPO
  if (!token || !owner || !repo) {
    return Response.json({ ok: false, error: 'Proxy not configured' }, { status: 503 })
  }
  const workflowId = env.WORKFLOW_ID || DEFAULT_WORKFLOW
  const ref = (body && body.ref) || env.WORKFLOW_REF || 'main'
  const inputs = (body && body.inputs) || { ref_name: ref }
  const url = 'https://api.github.com/repos/' + owner + '/' + repo +
    '/actions/workflows/' + encodeURIComponent(workflowId) + '/dispatches'
  const gh = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'asciidoc-link-validator-dispatch-proxy-worker',
    },
    body: JSON.stringify({ ref, inputs }),
  })
  if (gh.status === 204) {
    return Response.json({ ok: true, dispatched: true, ref, workflowId })
  }
  const text = await gh.text()
  return Response.json({ ok: false, error: 'dispatch failed', status: gh.status, body: text.slice(0, 500) }, { status: 502 })
}

async function probe (env, target) {
  if (!target) return Response.json({ ok: false, error: 'missing url' }, { status: 400 })
  let parsed
  try { parsed = new URL(target) } catch { return Response.json({ ok: false, error: 'invalid url' }, { status: 400 }) }
  if (!/^https?:$/i.test(parsed.protocol)) {
    return Response.json({ ok: false, error: 'only http(s) allowed' }, { status: 400 })
  }
  const allow = (env.PROBE_ALLOWLIST || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (allow.length) {
    const host = parsed.hostname.toLowerCase()
    if (!allow.some((suffix) => host === suffix || host.endsWith('.' + suffix))) {
      return Response.json({ ok: false, error: 'host not in PROBE_ALLOWLIST' }, { status: 403 })
    }
  }
  try {
    let r = await fetch(parsed.href, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': 'linkinator-probe/0.1' } })
    if (r.status === 405 || r.status === 501) {
      r = await fetch(parsed.href, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': 'linkinator-probe/0.1' } })
    }
    const ok = r.status >= 200 && r.status < 400
    return Response.json({ ok, status: ok ? 'ok' : 'invalid', httpStatus: r.status, url: parsed.href })
  } catch (err) {
    return Response.json({ ok: false, status: 'unknown', error: String(err && err.message ? err.message : err), url: parsed.href })
  }
}

export default {
  async fetch (request, env) {
    const origin = env.CORS_ORIGIN || '*'
    const headers = corsHeaders(origin)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    const url = new URL(request.url)
    let res
    if (url.pathname === '/health') {
      res = Response.json({ ok: true, service: 'link-validator-dispatch-proxy-worker' })
    } else if (url.pathname === '/dispatch' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      res = await dispatch(env, body)
    } else if (url.pathname === '/probe') {
      res = await probe(env, url.searchParams.get('url'))
    } else if (url.pathname === '/status') {
      res = Response.json({ ok: true, note: 'Wire STATUS_ARTIFACT_URL or use Express server.js for full status' })
    } else {
      res = new Response('dispatch-proxy worker: POST /dispatch  GET /probe?url=  GET /health\n', { status: 200 })
    }
    const out = new Response(res.body, res)
    for (const [k, v] of Object.entries(headers)) out.headers.set(k, v)
    return out
  },
}

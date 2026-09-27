'use strict'

const { mailtoHref, formatTextEmail } = require('./report.js')

/**
 * Shared triage action helpers (CI trigger + mailto + copy payload).
 *
 * Security: static HTML must NEVER embed secrets. Prefer a public
 * workflow_dispatch URL or a thin proxy that holds the token server-side.
 *
 * ciTrigger config shape (stored in report.meta.ciTrigger / triage HTML):
 * {
 *   enabled: boolean,
 *   provider: 'github' | 'gitlab',
 *   // Public dispatch endpoint OR thin proxy (no token in HTML):
 *   dispatchUrl: string,
 *   // Optional CORS-friendly status poll endpoint that returns latest report/artifact:
 *   statusUrl: string,
 *   // Optional display labels
 *   label: string,
 *   pollIntervalMs: number,
 * }
 */

function normalizeCiTrigger (raw = {}) {
  if (!raw || raw.enabled === false) {
    return { enabled: false, provider: null, dispatchUrl: null, statusUrl: null }
  }
  const provider = (raw.provider || 'github').toLowerCase()
  return {
    enabled: Boolean(raw.enabled && (raw.dispatchUrl || raw.workflowId || raw.projectId)),
    provider,
    dispatchUrl: raw.dispatchUrl || null,
    statusUrl: raw.statusUrl || null,
    workflowId: raw.workflowId || null,
    ref: raw.ref || 'main',
    label: raw.label || 'Check now (CI)',
    pollIntervalMs: Number(raw.pollIntervalMs) || 5000,
    // Documented: token must live in proxy / Actions secrets — never here
    note: 'Site stores only a public dispatch URL or thin proxy; do not embed secrets in static HTML.',
  }
}

function buildTriageActions (report, { ciTrigger } = {}) {
  const ci = normalizeCiTrigger(ciTrigger || report?.meta?.ciTrigger || {})
  const email = report?.meta?.reportEmail || 'support@devcentr.org'
  return {
    reportEmail: email,
    mailto: mailtoHref(report),
    copyText: formatTextEmail(report),
    copyJson: JSON.stringify(report, null, 2),
    ciTrigger: ci,
  }
}

/**
 * Client-side snippet config embedded into triage HTML (no secrets).
 */
function triageClientConfig ({ reportPath, reportEmail, ciTrigger } = {}) {
  return {
    reportUrl: reportPath || './report.json',
    reportEmail: reportEmail || 'support@devcentr.org',
    ciTrigger: normalizeCiTrigger(ciTrigger || {}),
  }
}

module.exports = {
  normalizeCiTrigger,
  buildTriageActions,
  triageClientConfig,
}

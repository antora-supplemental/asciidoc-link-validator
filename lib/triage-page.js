'use strict'

/**
 * Generate a static HTML triage page that loads report.json.
 */
function buildTriageHtml ({
  title = 'Link Validator',
  reportPath = './report.json',
  cssHref = '../_/css/link-validator.css',
  jsHref = '../_/js/link-validator.js',
  reportEmail = 'support@devcentr.org',
} = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${escapeHtml(cssHref)}">
</head>
<body class="lv-triage">
  <header class="lv-header">
    <h1>${escapeHtml(title)}</h1>
    <p class="lv-lede">Broken and suspicious outbound links found during the last site build.</p>
    <div class="lv-toolbar" id="lv-toolbar">
      <button type="button" id="lv-filter-page" class="lv-btn">Validate this page</button>
      <label class="lv-toggle"><input type="checkbox" id="lv-newly-only"> Newly invalid since last deployment</label>
      <button type="button" id="lv-copy" class="lv-btn">Copy report</button>
      <a id="lv-mailto" class="lv-btn lv-btn-primary" href="mailto:${escapeHtml(reportEmail)}">Email report</a>
    </div>
  </header>
  <main>
    <section id="lv-summary" class="lv-summary" aria-live="polite">Loading report…</section>
    <table class="lv-table" id="lv-table">
      <thead>
        <tr>
          <th>URL</th>
          <th>Status</th>
          <th>Classification</th>
          <th>Source page</th>
          <th>Delta</th>
        </tr>
      </thead>
      <tbody id="lv-tbody"></tbody>
    </table>
  </main>
  <script>
    window.LINK_VALIDATOR_REPORT_URL = ${JSON.stringify(reportPath)};
    window.LINK_VALIDATOR_REPORT_EMAIL = ${JSON.stringify(reportEmail)};
  </script>
  <script src="${escapeHtml(jsHref)}" defer></script>
</body>
</html>
`
}

function escapeHtml (s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

module.exports = { buildTriageHtml, escapeHtml }

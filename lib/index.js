'use strict'

module.exports = {
  ...require('./extract.js'),
  ...require('./check.js'),
  ...require('./suppressions.js'),
  ...require('./report.js'),
  ...require('./baseline.js'),
  ...require('./scan-fs.js'),
  ...require('./triage-page.js'),
}

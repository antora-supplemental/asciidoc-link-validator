# TeamCity

1. Add a Command Line build step on a Node 18+ agent.
2. Run: `node bin/asciidoc-link-validator.js --root . --out link-report.json --fail`
3. Publish `link-report.json` as an artifact.

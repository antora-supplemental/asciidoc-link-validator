# Buildkite

Add a step that runs the same CLI:

```bash
node bin/asciidoc-link-validator.js --root . --out link-report.json --fail
# after publish: pnpm dlx @antora-supplemental/asciidoc-link-validator --root . --fail
```

Artifact: upload `link-report.json`.

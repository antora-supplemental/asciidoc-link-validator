# CI packs for AsciiDoc Link Validator

Every provider invokes the **same CLI**. Prefer a package checkout until `@antora-supplemental/asciidoc-link-validator` is on npm:

```bash
node bin/asciidoc-link-validator.js --root . --fail --out link-report.json
```

After publish:

```bash
pnpm dlx @antora-supplemental/asciidoc-link-validator --root . --fail
# or: npx @antora-supplemental/asciidoc-link-validator ...
```

| File | Provider |
| --- | --- |
| `../.github/workflows/link-validator.yml` | GitHub Actions |
| `../action.yml` | GitHub Marketplace composite action |
| `gitlab-ci.link-validator.yml` | GitLab CI |
| `azure-pipelines.link-validator.yml` | Azure Pipelines |
| `bitbucket-pipelines.link-validator.yml` | Bitbucket |
| `circleci.link-validator.yml` | CircleCI |
| `Jenkinsfile.link-validator` | Jenkins |
| `woodpecker.link-validator.yml` | Woodpecker |
| `gitea-actions.link-validator.yml` | Gitea Actions |
| `buildkite.link-validator.md` | Buildkite (stub) |
| `travis.link-validator.yml` | Travis (stub) |
| `drone.link-validator.yml` | Drone (stub) |
| `codefresh.link-validator.yml` | Codefresh (stub) |
| `semaphore.link-validator.yml` | Semaphore (stub) |
| `teamcity.link-validator.md` | TeamCity (stub) |
| `forgejo.link-validator.yml` | Forgejo (stub) |

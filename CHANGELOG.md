## [2.0.2](https://github.com/RJonMshka/dev-sesssion/compare/v2.0.1...v2.0.2) (2026-06-19)

### Bug Fixes

* three v2.0.1 smoke-test bugs (lint-context --json, mcp version, advance exit code) ([ac920ac](https://github.com/RJonMshka/dev-sesssion/commit/ac920accb85b1193192d2647a1d8e7cba5507312))

## [2.0.1](https://github.com/RJonMshka/dev-sesssion/compare/v2.0.0...v2.0.1) (2026-06-19)

### Bug Fixes

* **release:** copy README into CLI package before npm publish ([370ce2e](https://github.com/RJonMshka/dev-sesssion/commit/370ce2e26b2fdfe1c6acb8798d7ad97cb50bff4e))

## [2.0.0](https://github.com/RJonMshka/dev-sesssion/compare/v1.0.2...v2.0.0) (2026-06-19)

### ⚠ BREAKING CHANGES

* **cli:** the published package and the binary are now
`dev-sesssion` (three s). Installs and invocations using the old
`dev-session` name no longer resolve.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

### Features

* **cli:** rename package and command to dev-sesssion ([b7bc080](https://github.com/RJonMshka/dev-sesssion/commit/b7bc080045b49dc7e5832b5f680d38d78d3280ad))
* **core,cli,adapters:** add Windsurf adapter (Chunk 16) ([18f6cb6](https://github.com/RJonMshka/dev-sesssion/commit/18f6cb6eb0a5a9352e4c72e4f714124970ec75e1))
* **core,cli,adapters:** wire layered context loading into bootstrap (Chunk 15) ([bf9e2fa](https://github.com/RJonMshka/dev-sesssion/commit/bf9e2fab58ebf58b1b4cef6051cb66608138a772))
* **core,cli:** add SessionManager facade and MCP server (Chunk 14) ([a4a7088](https://github.com/RJonMshka/dev-sesssion/commit/a4a7088cc95a232e4f590f380daa34d94d17ce98))
* **core:** add AnnotationParser for [@ai](https://github.com/ai)-* index overrides (Chunk 13) ([b05dcfd](https://github.com/RJonMshka/dev-sesssion/commit/b05dcfdc250b27e89f4c6ff7673a70bc12f85949))

### Bug Fixes

* **ci:** add write-guard.test.ts to gitleaks allowlist ([8f81ed0](https://github.com/RJonMshka/dev-sesssion/commit/8f81ed0d5bce0aa21e6e59a1436f8257cc8bc288))
* **core:** correct PlanParser chunk-splitting drift ([3cc482b](https://github.com/RJonMshka/dev-sesssion/commit/3cc482b486c141278aee9788b5a9d0694ae854cc))

### Documentation

* **plan:** reconcile build status and document chunks 12-13 ([2a70db9](https://github.com/RJonMshka/dev-sesssion/commit/2a70db9e88989503288f728b603899ebc3a74d4d))

## [1.0.2](https://github.com/RJonMshka/dev-sesssion/compare/v1.0.1...v1.0.2) (2026-04-19)

### Documentation

* **README:** v1.0.0 rewrite, API reference, fix package name to dev-sesssion ([b0b8491](https://github.com/RJonMshka/dev-sesssion/commit/b0b8491541c72244bfaf9d48aa2cd05e8e441943))

## [1.0.1](https://github.com/RJonMshka/dev-sesssion/compare/v1.0.0...v1.0.1) (2026-04-19)

### Documentation

* **README:** readme and API added ([b1dd395](https://github.com/RJonMshka/dev-sesssion/commit/b1dd3959df58d5be360ff4d58e295761597c9c1f))

## 1.0.0 (2026-04-13)

### ⚠ BREAKING CHANGES

* first stable release of dev-sesssion v1.0.0

### Features

* initial public release ([87591db](https://github.com/RJonMshka/dev-sesssion/commit/87591dbe5c0ca13a54b05353b416d46fd743178d))

# Changelog

All notable changes to this project will be documented in this file.

This file is generated automatically by [semantic-release](https://semantic-release.gitbook.io/semantic-release/).

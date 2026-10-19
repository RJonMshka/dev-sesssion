## [2.3.0](https://github.com/RJonMshka/dev-sesssion/compare/v2.2.1...v2.3.0) (2026-08-30)

### Features

* **cli:** report what splitting a plan skipped and why ([4c2d677](https://github.com/RJonMshka/dev-sesssion/commit/4c2d6770d2a3d32c60022da796080fc457ced978))
* **core:** add a registry of plan sources ([3bdbdb4](https://github.com/RJonMshka/dev-sesssion/commit/3bdbdb4afdbdef8ea13f550605543c714f88f66d))

### Bug Fixes

* **adapters:** correct stale line cap and repository URL in boilerplate ([41a95a6](https://github.com/RJonMshka/dev-sesssion/commit/41a95a654aea0f558e0b8c32a3cc9f82fe126316))
* **core,cli:** stop FILE_INDEX corruption, support fractional chunk ids, honour --dry-run ([fc38979](https://github.com/RJonMshka/dev-sesssion/commit/fc38979a16a4693bd361d7c8f6cc845fa75be1e9))

### Documentation

* add an index for docs/ ([99596bd](https://github.com/RJonMshka/dev-sesssion/commit/99596bd07193f2ead9f4300f1e63e3c48af5f771))
* adopt HLD/LLD/EARS + TDD as the working method; freeze .session/ ([481706d](https://github.com/RJonMshka/dev-sesssion/commit/481706d3e97938e5d179644bde18c82224188cb3))
* correct the audit step in the releasing guide ([3c445c8](https://github.com/RJonMshka/dev-sesssion/commit/3c445c8ce5f51db0af8e3b03b55e0e5336a4f851))
* delete the semantic-release setup scratch notes ([b7cb725](https://github.com/RJonMshka/dev-sesssion/commit/b7cb72559029e3d5a7d45b4333693f87d7374e65))
* **evals:** add the eval report ([c063320](https://github.com/RJonMshka/dev-sesssion/commit/c06332088af44274d557c5ba4a5e297774e64392))
* fold the release and test plans into one releasing guide ([cc029a8](https://github.com/RJonMshka/dev-sesssion/commit/cc029a8edd985cf93c9a63ca98f5b35ad2f44772))
* move the superseded plans into docs/archive/ ([8f5fb2f](https://github.com/RJonMshka/dev-sesssion/commit/8f5fb2f3948040de4ea557515d865aebe6f646f6))
* **plan:** add the LLD for the plan source registry ([2503aac](https://github.com/RJonMshka/dev-sesssion/commit/2503aacb044bb2d28deb66c7b6c82cc421c239cc))
* retire the .session/ archive ([eca8031](https://github.com/RJonMshka/dev-sesssion/commit/eca803139b0c6dbeff05d89c13e2987f21a0f8d2))
* stop duplicating the command reference in GUIDE.md ([b93ebc8](https://github.com/RJonMshka/dev-sesssion/commit/b93ebc87ee70853926c92ca234c1525658e7f9ec))

## [2.2.1](https://github.com/RJonMshka/dev-sesssion/compare/v2.2.0...v2.2.1) (2026-08-23)

### Bug Fixes

* **formatters:** dedupe always-include and chunk file lists ([82898dd](https://github.com/RJonMshka/dev-sesssion/commit/82898ddea0f7de98a11b9e97af9b3d0b2b069c60))

## [2.2.0](https://github.com/RJonMshka/dev-sesssion/compare/v2.1.0...v2.2.0) (2026-08-23)

### Features

* **cli:** add the verify command ([fee01f9](https://github.com/RJonMshka/dev-sesssion/commit/fee01f9245f86349cfc6261aac4277eb94562580))
* **cli:** apply the configured prompt cap across commands ([5baf318](https://github.com/RJonMshka/dev-sesssion/commit/5baf318f73cbd51506e433fd8739aeb3835586a8))
* **cli:** scan for secrets before compact uploads a file ([c644dd8](https://github.com/RJonMshka/dev-sesssion/commit/c644dd850b42017a39cf7a1685653f1549faa368))
* **core:** add a read-only git access layer ([4aee05f](https://github.com/RJonMshka/dev-sesssion/commit/4aee05ff363c332b269933dbe6989306dab40abd))
* **core:** honor the configured prompt cap in every formatter ([e462e6f](https://github.com/RJonMshka/dev-sesssion/commit/e462e6f96fb3e1c8a59a6a9b5ec32f7bd7c41805))
* **core:** make the NEXT_PROMPT.md line cap configurable ([8e00ce3](https://github.com/RJonMshka/dev-sesssion/commit/8e00ce3d206dc4ef4340096e779834d087a42f9d))
* **core:** reconcile session state against git history ([da9154e](https://github.com/RJonMshka/dev-sesssion/commit/da9154ea5c5e3f49a55e77dfe06f35388220e4e7))
* **core:** score past prompts against the commits that followed ([7b84ebc](https://github.com/RJonMshka/dev-sesssion/commit/7b84ebc88b374e8be9a2e737d3241bcf13781dce))

### Bug Fixes

* **ci:** give gitleaks the history it needs to scan pushes ([c2f7986](https://github.com/RJonMshka/dev-sesssion/commit/c2f7986561ceca2e034488cd1d3182f98988e9b8))
* **core:** give file-load line prefixes one source of truth ([c3d7ce2](https://github.com/RJonMshka/dev-sesssion/commit/c3d7ce2ff042e6110b8ebbc7ae38e4cf08887204))
* **core:** validate NEXT_PROMPT.md before writing it ([296db2e](https://github.com/RJonMshka/dev-sesssion/commit/296db2e6e69ddc0d237cd433f48356bfc4434941))

### Documentation

* align the session routine with the enforced line cap ([b8273b7](https://github.com/RJonMshka/dev-sesssion/commit/b8273b7bf330c72ea7eb4cbde6ad384bdcb97500))
* correct references that contradict the code ([8a7d604](https://github.com/RJonMshka/dev-sesssion/commit/8a7d604eb222ac574610a06e2384cd0d5cdc1ab4))
* document verify, replay scoring, and the prompt cap ([8fe35df](https://github.com/RJonMshka/dev-sesssion/commit/8fe35dff6fb9e0d53e5357af9573eb00638166d5))

## [2.1.0](https://github.com/RJonMshka/dev-sesssion/compare/v2.0.2...v2.1.0) (2026-07-05)

### Features

* **adapters:** add registerAdapter() for pluggable custom adapters ([6de2f26](https://github.com/RJonMshka/dev-sesssion/commit/6de2f26d68013b6afda3e183e4461d3d85af4ff2))

### Documentation

* fix stale Windsurf gaps, document custom adapter registration ([63a50b9](https://github.com/RJonMshka/dev-sesssion/commit/63a50b9c1957aed6f2087b8217ed79677897aef8))

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

## [3.0.0](https://github.com/RJonMshka/dev-sesssion/compare/v2.4.2...v3.0.0) (2026-10-27)

### ⚠ BREAKING CHANGES

* the `compact` command is removed. Ask the agent in your
harness to shorten the file, then run `dev-sesssion update`.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

### Features

* **advance:** --json output, and refuse to prompt without a TTY ([c96308d](https://github.com/RJonMshka/dev-sesssion/commit/c96308d4e624ce5adcb351db4d2502d941db1b94))
* **index:** index the script blocks of .vue and .svelte components ([84e646a](https://github.com/RJonMshka/dev-sesssion/commit/84e646a9d7cb7925fd7adbf7f93db61485c2cd7c))
* **init:** --plan <file> reads a named plan instead of PLAN.md ([133b653](https://github.com/RJonMshka/dev-sesssion/commit/133b6539b044799281c3422430cf367aaeebefa7))
* **init:** say what to do when there is no plan ([a7d9903](https://github.com/RJonMshka/dev-sesssion/commit/a7d9903088615cc924eb83daa9e26af63aca3d2e))
* **init:** start a session mid-plan with --chunk ([b74010f](https://github.com/RJonMshka/dev-sesssion/commit/b74010f2f27ad345d668c8f2e562b537ff7cfbd8))
* **init:** tag from the plan with or without --yes, and ask nothing ([4c756d6](https://github.com/RJonMshka/dev-sesssion/commit/4c756d6f1b5e5ccce18548b5641d45b052fe20a5))
* **init:** tag the files a plan names outside its tasks ([a630e4a](https://github.com/RJonMshka/dev-sesssion/commit/a630e4a6475a37e90e8a40c8a2afb8e5108b7849))
* **init:** write the plan skill for Claude Code, and refresh it on update ([cb00e10](https://github.com/RJonMshka/dev-sesssion/commit/cb00e10de26912077e93b6be44feaed69ce10e82))
* **mcp:** check_plan, a read-only tool that checks a plan file ([954ee32](https://github.com/RJonMshka/dev-sesssion/commit/954ee329765e3a726bbe10c7ecd49e95edf3dd98))
* **notes:** show the newest owner notes, and archive them at advance ([8b6e0a3](https://github.com/RJonMshka/dev-sesssion/commit/8b6e0a3080b7c28fac3de58bc1a973d4f95d53c4))
* **plan:** plan check reports whether a plan will parse ([189f72e](https://github.com/RJonMshka/dev-sesssion/commit/189f72eb9786d543187c9f99eb99ea1a227f0c16))
* **prompt:** files a chunk will create ([df29c01](https://github.com/RJonMshka/dev-sesssion/commit/df29c01eaa6efd0843d4f03c2d70c9402a329134))
* **prompt:** give the agent the chunk's goal and steps, and every file ([4908221](https://github.com/RJonMshka/dev-sesssion/commit/490822152c27161b53780eb60c19ba06f1059134))
* **prompt:** say which task is current and when the chunk is done ([709df0e](https://github.com/RJonMshka/dev-sesssion/commit/709df0e13d878bc749522bb9b416334340011fc9))
* remove compact; dev-sesssion calls no model and needs no API key ([8ba5142](https://github.com/RJonMshka/dev-sesssion/commit/8ba5142026cb329238526a5ab1a622481f3406ac))
* **skill:** the plan skill's text, and ownership-aware sync ([248e9d8](https://github.com/RJonMshka/dev-sesssion/commit/248e9d84da87c482d36df29b073cc25f33e7f1ee))
* **symbols:** show what the ai-index holds for a file or a name ([f2f60c7](https://github.com/RJonMshka/dev-sesssion/commit/f2f60c7357d379386293dc674cfaded2842f04e0))
* **update:** tag the files a session changed to the active chunk ([602bc3f](https://github.com/RJonMshka/dev-sesssion/commit/602bc3f3bdd1304bccfc65d114a5520a33c544d0))

### Bug Fixes

* **advance:** advance in plan order, across fractional ids and gaps ([1901b2a](https://github.com/RJonMshka/dev-sesssion/commit/1901b2a310bd58111be0c311158f0cb57e576fa2))
* **budget:** judge the chunk, not the files every chunk loads ([d91ac90](https://github.com/RJonMshka/dev-sesssion/commit/d91ac902390f09c16a5340f061adab4f4ee56692))
* **budget:** report one measured budget from every command ([48e4722](https://github.com/RJonMshka/dev-sesssion/commit/48e47224897212c7426c6dacb3ff52ab49b58408))
* **health:** judge the budget the prompt is charged ([3e2595f](https://github.com/RJonMshka/dev-sesssion/commit/3e2595f1eebc019287612d007182b720d53e6946))
* **import:** quote prose from CLAUDE.md, not tables and code blocks ([1c73bec](https://github.com/RJonMshka/dev-sesssion/commit/1c73bec84fc70ee60b67d2c9aac72cc8acd38bb9))
* **index:** drop FILE_INDEX rows that point outside the project ([e9b81fc](https://github.com/RJonMshka/dev-sesssion/commit/e9b81fc455e9cd5cfa0d82afbf2f2bb0dbdada84))
* **index:** quote doc-comment summaries in index --show and --file ([2e0a595](https://github.com/RJonMshka/dev-sesssion/commit/2e0a595ba0c201ff9c79744a065069f4f22d3c51))
* **index:** redact secrets in doc comments, and say so ([aab9022](https://github.com/RJonMshka/dev-sesssion/commit/aab9022fd48a977de6479a68d10497061f5a41d5))
* **session:** marking a task done reaches the prompt and status ([c57608f](https://github.com/RJonMshka/dev-sesssion/commit/c57608fd6f4a846cd92784bd742e6ae56cc04ea7))

### Documentation

* describe plan-named files, briefs, --chunk and one budget ([7f95cc6](https://github.com/RJonMshka/dev-sesssion/commit/7f95cc620d97bf57eebdfd7a21a873b31e084e18))
* **plan:** LLD for plan authoring and harness orchestration ([ef40841](https://github.com/RJonMshka/dev-sesssion/commit/ef40841b6d2a88c6d46325d0aaf68ced3f8ddec7))
* **plan:** LLDs for every open item, and a build order ([7a5d6d4](https://github.com/RJonMshka/dev-sesssion/commit/7a5d6d4bb951ab981e3f64f4cc140bf3535ce319))
* **plan:** mark build-order steps 1–3 done ([71cbd23](https://github.com/RJonMshka/dev-sesssion/commit/71cbd23b1e2382ed09442393ed37c0cd28e98e69))

## [2.4.2](https://github.com/RJonMshka/dev-sesssion/compare/v2.4.1...v2.4.2) (2026-10-20)

### Bug Fixes

* **init:** make the first prompt usable without extra commands ([5658c13](https://github.com/RJonMshka/dev-sesssion/commit/5658c139f4d94a18161f3f8a7908073e9e95160d))

### Documentation

* **plan:** design the first run (LLD-first-run, area RUN) ([5403a41](https://github.com/RJonMshka/dev-sesssion/commit/5403a4191195e3335a870e4527c121b709347302))

## [2.4.1](https://github.com/RJonMshka/dev-sesssion/compare/v2.4.0...v2.4.1) (2026-10-19)

### Bug Fixes

* **security:** quote repository text lifted into agent-facing output ([87cda6f](https://github.com/RJonMshka/dev-sesssion/commit/87cda6f8b7a69ef5c74509609aaa61e523db4c5f))

### Documentation

* **plan:** finish the context-provenance design against 2.4.0 ([6895a0c](https://github.com/RJonMshka/dev-sesssion/commit/6895a0c77f09612a37ee7a48c7f6eab879f4dc9a))

## [2.4.0](https://github.com/RJonMshka/dev-sesssion/compare/v2.3.0...v2.4.0) (2026-10-19)

### Features

* **core:** code units, unit focus, and the context manifest (REQ-UNIT) ([0855cf1](https://github.com/RJonMshka/dev-sesssion/commit/0855cf1b0fb27df8a14548ea63c6e098f5d31a81))

### Bug Fixes

* **evals:** exit non-zero on a failed check, and gate CI on it (REQ-EVAL-7) ([fa1c042](https://github.com/RJonMshka/dev-sesssion/commit/fa1c04220ab171f22ce233b343c9d920b073b354))

### Documentation

* **evals:** critique the eval methodology and confirm two injection paths ([6220a4e](https://github.com/RJonMshka/dev-sesssion/commit/6220a4eeb8095dd5c422047ac1cbac11bf201539))
* give CLAUDE.md the architecture and test commands it was missing ([8f84ef9](https://github.com/RJonMshka/dev-sesssion/commit/8f84ef9a2e3bf6b35f7a854ea1b7010bde16e4ec))
* **plan:** add LLD for code units (REQ-UNIT-1..34) ([0c66f8f](https://github.com/RJonMshka/dev-sesssion/commit/0c66f8fa05a56f6f40fbbc5f39c5ac703ef3bf88))
* **plan:** design context provenance and eval harness integrity ([56e1265](https://github.com/RJonMshka/dev-sesssion/commit/56e12654aa4b05bad446687a96fdfd04a06e5881))
* record the schema/PROTOCOL.md coupling in CLAUDE.md ([3236650](https://github.com/RJonMshka/dev-sesssion/commit/3236650dd5a1e53f11b8ea05d747343f9f909c46))
* record the trust boundary and evals/ status in CLAUDE.md ([8d10072](https://github.com/RJonMshka/dev-sesssion/commit/8d10072f6a5e6269404b85c7a3b63bd2b92a47c1))

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

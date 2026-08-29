# Documentation

## Using dev-sesssion

| Doc | What it covers |
|---|---|
| [getting-started.md](getting-started.md) | Install, the init wizard, the `.session/` layout, your first session |
| [GUIDE.md](GUIDE.md) | The concepts — chunks, file index, budgets — and the day-to-day loop |
| [commands.md](commands.md) | Every command, flag, exit code and `--json` shape |
| [adapters.md](adapters.md) | Claude Code, opencode, Cursor, Windsurf: detection, output, switching |
| [team-mode.md](team-mode.md) | Shared repos — what is committed and what stays local |

## Extending it

| Doc | What it covers |
|---|---|
| [authoring-adapters.md](authoring-adapters.md) | Writing and registering a new adapter |
| [API.md](API.md) | `@dev-session/core` exports for programmatic use |
| [../PROTOCOL.md](../PROTOCOL.md) | The on-disk format the tool manages, specified independently of this implementation |

## Working on dev-sesssion

| Doc | What it covers |
|---|---|
| [METHOD.md](METHOD.md) | How this repo is developed: HLD → LLD → EARS → TDD, and the definition of done |
| [plan/HLD.md](plan/HLD.md) | Architecture across the work currently in flight |
| [plan/](plan/) | One LLD per feature, carrying its EARS requirements |
| [releasing.md](releasing.md) | The semantic-release pipeline, pre-merge checks, post-publish smoke test |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Setup, branch and commit conventions, PR expectations |

## History

[archive/](archive/README.md) — the superseded v1 and v2 plans, and the running
notes from the nineteen chunks the project was originally built in. Kept because
they record why the code is shaped the way it is; nothing there describes current
behaviour.

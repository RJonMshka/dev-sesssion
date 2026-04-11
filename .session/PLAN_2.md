---
chunk_id: 2
title: "Security utilities (`packages/security`)"
depends_on: []
tasks:
  - text: "`PathValidator` — `safeResolvePath(userPath, projectRoot)` using `fs.realpath()` + boundary check"
    status: todo
  - text: "`ContentSanitizer` — strips prototype pollution keys (`__proto__`, `constructor`, `prototype`) from parsed objects"
    status: todo
  - text: "`FrontmatterParser` — wraps `@11ty/gray-matter` with JS engine disabled + Zod schema validation"
    status: todo
  - text: "`SecretScanner` — synchronous regex scan for 10 known secret patterns"
    status: todo
  - text: "`WriteGuard` — middleware wrapping atomic file writes: scan → warn/block → write"
    status: todo
  - text: "`AtomicWriter` — `writeFileAtomic(path, content)` using `write-file-atomic` package"
    status: todo
  - text: "`CliError` — user-facing message + optional `cause` + optional `suggestion` field"
    status: todo
  - text: "`ParseError` — includes `file` (relative path), `line` (optional), safe `message`"
    status: todo
  - text: "`SecurityError` — includes `threat` enum (PATH_TRAVERSAL | SECRET_DETECTED | INJECTION_ATTEMPT | PROTOTYPE_POLLUTION)"
    status: todo
  - text: "PathValidator: `../../../etc/passwd`, null bytes, symlink traversal, absolute paths, valid paths"
    status: todo
  - text: "FrontmatterParser: JS frontmatter `---js`, prototype pollution keys, unknown fields (`.strict()`), valid YAML"
    status: todo
  - text: "SecretScanner: each of the 10 patterns triggers, partial matches don't trigger, redacted output verified"
    status: todo
  - text: "WriteGuard: warn mode writes despite detection, strict mode blocks, bypass comment respected"
    status: todo
  - text: "AtomicWriter: partial write simulation (process kill mid-write verifies no corruption)"
    status: todo
---

## Chunk 2 — Security utilities (`packages/security`)

### Tasks

- [ ] `PathValidator` — `safeResolvePath(userPath, projectRoot)` using `fs.realpath()` + boundary check
- [ ] `ContentSanitizer` — strips prototype pollution keys (`__proto__`, `constructor`, `prototype`) from parsed objects
- [ ] `FrontmatterParser` — wraps `@11ty/gray-matter` with JS engine disabled + Zod schema validation
- [ ] `SecretScanner` — synchronous regex scan for 10 known secret patterns
- [ ] `WriteGuard` — middleware wrapping atomic file writes: scan → warn/block → write
- [ ] `AtomicWriter` — `writeFileAtomic(path, content)` using `write-file-atomic` package
- [ ] `CliError` — user-facing message + optional `cause` + optional `suggestion` field
- [ ] `ParseError` — includes `file` (relative path), `line` (optional), safe `message`
- [ ] `SecurityError` — includes `threat` enum (PATH_TRAVERSAL | SECRET_DETECTED | INJECTION_ATTEMPT | PROTOTYPE_POLLUTION)
- [ ] PathValidator: `../../../etc/passwd`, null bytes, symlink traversal, absolute paths, valid paths
- [ ] FrontmatterParser: JS frontmatter `---js`, prototype pollution keys, unknown fields (`.strict()`), valid YAML
- [ ] SecretScanner: each of the 10 patterns triggers, partial matches don't trigger, redacted output verified
- [ ] WriteGuard: warn mode writes despite detection, strict mode blocks, bypass comment respected
- [ ] AtomicWriter: partial write simulation (process kill mid-write verifies no corruption)

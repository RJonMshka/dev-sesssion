# Provenance fixtures

Adversarial inputs for `docs/plan/LLD-context-provenance.md` (area `PROV`).
Each one reproduces an attack that was confirmed against a released build, so
keep them byte-for-byte as they are. Tests copy them into a temp project. Never
run `dev-sesssion` against this directory.

| File | Attack | Requirements |
|---|---|---|
| `CLAUDE.md` | An imported `##` section becomes a `Note:` line in the prompt | REQ-PROV-1, -11 |
| `src/annotated.ts` | `@ai-summary` text served by `read_file_layer` | REQ-PROV-2 |
| `src/plain-doc.ts` | The same text from a plain doc comment, with no annotation | REQ-PROV-8 |
| `src/routes.ts` | A string-literal member key that becomes a unit id on the `Focus` line | REQ-PROV-9 |

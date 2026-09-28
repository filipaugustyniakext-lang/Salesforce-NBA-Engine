# Copy Center Template Package Contract v1

Each versioned Channel Template must include exactly one `template.manifest.json`.
The manifest is the package source of truth; uploaded JavaScript is reference-only
and is never executed by Copy Center.

## Activation requirements

- All channels: valid manifest, approved preview compiler, matching channel kind.
- Email: one Shell HTML file containing the declared BODY slot or `{{CONTENT}}`.
- Content blocks: every referenced HTML file must exist and every `{{TOKEN}}`
  must be declared by its manifest entry.
- HTML/CSS: scripts, inline event handlers, and `javascript:` URLs are rejected.

## Trusted preview compilers

| Channel | `runtime.previewCompiler` |
|---|---|
| Email | `email-preview@1` |
| Web Banner | `banner-lwc@1` |
| Push | `push-device@1` |
| SMS | `sms-preview@1` |

Template admins upload package source through Marketing Dictionary. CRM operators
edit message values in Copy Center; they do not edit or execute package source.
Active package versions are immutable and receive a SHA-256 checksum.

See `template.manifest.schema.v1.json` and
`../email/examples/template.manifest.json`.

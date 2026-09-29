# Copy Center template packages

Template authors work in Marketing Dictionary. They upload the shell and component HTML, then describe each component in the visual catalog. Copy Center stores that catalog as schema 2.0. Authors do not upload a manifest and do not enter SFMC slot keys, roles, or renderer ids.

## What the author provides

- Shell HTML, and optional CSS or JavaScript source. JavaScript is stored only and is never executed.
- One HTML file per supported component: Rich Text, Image, Text-Image, Banner, Prefooter, or Spacer.
- For each file: component type, display name, description, and SLDS utility icon.

Email shell HTML should contain `{{CONTENT}}` where message components are inserted. An existing BODY slot is still accepted.

## What the system derives

- Package id from the template name
- Semantic version from the template version
- Preview compiler from the channel type
- Placeholder list by scanning each component file
- Renderer from the component type
- SHA-256 checksum when the package is validated

Active packages stay immutable.

## Legacy manifest files

A previously uploaded `template.manifest.json` (schema 1.x) still validates. New templates use the component catalog instead. See `template.manifest.schema.v2.json`.

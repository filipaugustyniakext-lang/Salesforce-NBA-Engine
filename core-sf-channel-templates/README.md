# Core SF Channel Templates — Handoff Extract

Give the Core SF (LWC/Apex) agent this folder.

**Start here:** [`00-index/INDEX.md`](./00-index/INDEX.md)

| Folder | Contents |
|--------|----------|
| `email/` | Master + block HTML shells, config, preview assembly JS |
| `banners/` | Per-type CSS + content models + Vue preview/editor references |
| `push/` | Device preview Vue + type/behaviour config |
| `sms/` | Bubble preview HTML builder + CSS |
| `00-index/` | INDEX + source path map |

Email = real HTML shells. Banners = CSS + Vue (no HTML masters) — reimplement preview in LWC.

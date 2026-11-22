# Apps Script (dev)

Dev copies of the Google Apps Script project "BasManTechnlodData". Not served by the website.

- `Code.gs` — main script. Dev change: `publicJob_` exposes `source` / `sourceUrl` for external jobs.
- `JobFetcher.gs` — fetches external jobs (Adzuna, Jooble, Careerjet, Greenhouse, Lever,
  Remotive, RemoteOK) into an "External Jobs" review tab; `publishApprovedExternal` posts
  approved rows through `saveJob_` with Posted by = "External: <source>".

API keys and the admin key live in Script Properties, never in this repo.
After pasting into Apps Script: Deploy → Manage deployments → ✏️ → New version (never "New deployment").

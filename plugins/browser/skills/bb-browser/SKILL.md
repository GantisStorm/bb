---
name: bb-browser
description: Use the visible BB Browser through explicit client and tab targets.
---

# BB Browser

Use `bb browser list --json` before targeting a Browser tab. Only entries with
`connected: true` are actionable. Inactive persisted tabs are listed with
`connected: false`; activate one through the connected tab in its panel owner.
Every action uses an exact client, window, tab, and navigation revision.

`open` without destination fields creates the calling thread's first Browser
tab even when that thread has no mounted Browser panel. It never falls back to
another thread's Browser. Pass `threadId` and `projectId` only for an explicit
cross-thread destination; BB creates a background thread-owned Browser without
changing the visible app layout. Use `clientId` and `windowId` when multiple
active BB app windows make that destination ambiguous.

```sh
bb browser list --json
bb browser open --thread <thread-id> --url <url> --json
bb browser run --client <client-id> --window <window-id> --tab <tab-id> --epoch <navigation-epoch> --action '{"kind":"snapshot","mode":"interactive"}' --json
bb browser run --client <client-id> --window <window-id> --tab <tab-id> --epoch <navigation-epoch> --action '{"kind":"click","target":{"target":"locator","locator":{"role":"button","name":"Save"}}}' --json
bb browser wait --client <client-id> --window <window-id> --tab <tab-id> --epoch <navigation-epoch> (--locator <json> | --text <text> | --url <url> | --navigation <start|commit> | --load-state <state> | --popup | --request <url> | --response <url> | --download-blocked>) [--match <exact|glob>] --json
bb browser batch --items <json> --json
```

Use snapshots to derive CSS or accessibility locators. A selector chain crosses
shadow roots. Use `list-frames` to discover nested or cross-origin frames, then
attach the returned opaque frame target to the locator. Prefer locators over
coordinates. Pointer actions include left/right/middle click, hover,
double-click, and drag. Form actions include type, bounded base64 upload,
single/multiple select, check, uncheck, focus, keyboard input, and clear via
`type` with empty text plus `clear: true`.

Screenshots support viewport, full page, and one element. Configure
`set-dialog-handler` before the action that opens the next JavaScript dialog.
`set-permissions` changes only the selected tab. `diagnostics` returns bounded
console, page-error, network, blocked-download, permission, dialog, page-state,
and navigation timing data. Page storage actions cover local/session storage
and script-visible cookies. Native profile import uses
`list-cookie-import-sources` followed by `import-cookies-from-browser`.
`clear-imported-cookies` requires `confirm: true` and clears the shared managed
Browser partition. Downloads remain blocked.

`open` and `open-tab` wait for a stable native page target. `activate-tab`
returns the activated tab's stable target. `close-tab` closes only the selected
revision. Unsupported navigation schemes and stale revisions reject instead of
retargeting another Browser client, window, tab, or page.

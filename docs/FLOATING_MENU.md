# Floating menu — 0.8.0

The rounded card now opens **inside the webpage**, near its top-right corner. The page is visible outside its curved edges. The native toolbar popup is no longer the normal menu; removing its default popup lets the toolbar action inject the menu only after an explicit click. The user selected this change to remove Chrome's rectangular backing. This follows [Chrome's action/content-script pattern](https://developer.chrome.com/docs/extensions/reference/api/action).

Click Aksara on an ordinary HTTP(S) page, choose From/To and enable translation. The menu closes after activation so image controls are unobstructed. Close, Escape, an outside click or another toolbar click dismisses it. Reopening recognizes an already enabled page without clearing results. Site disable/allow still requires explicit reactivation. On browser pages or other restricted documents, the toolbar opens extension Settings instead. The Local badge remains removed.

`src/page-menu.ts` bundles the shared popup markup, CSS and tokens as a classic isolated-world script. A Shadow DOM contains an automatic popover in the browser's top layer. Its only painted surface is the 22 px rounded card; the backdrop is transparent. A compact close button, visual-viewport positioning, narrow-layout stacking and constrained scrolling handle small/zoomed windows. No new UI package or per-text blur is added. The menu entry is about 18 kB / 6.31 kB gzip and loads only on toolbar activation. Opening it does not acquire pixels, run OCR, prepare inference or download weights.

The interior uses an opaque pale base with static glass highlights so host-page text cannot show through the controls. The area outside its curves remains transparent; no whole-card blur is required.

## Background contracts

Requests use schema version 1, target `background`, and these fixed types:

| Request | Effect / reply |
|---|---|
| `GET_PAGE_MENU_STATE` | Compact model summary (`summary`, `state`, `running`, `needsSetup`), current image-control connection, and an optional pending host belonging to this document. |
| `ENABLE_PAGE_IMAGES` | Rechecks the exact-origin site preference and installs `content.js` only in the sender's document if needed. Returns connection/image-count feedback. |
| `OPEN_PRIVACY` | Opens the fixed packaged privacy page. No supplied URL is used. |
| `OPEN_SETUP` | Existing fixed Settings route, used for model setup and explicit image-access review. |

The new broker accepts only this extension's top-frame HTTP(S) content sender with a Chrome document ID. It checks the current tab is active and its URL still matches, derives origin/tab/document from Chrome metadata and ignores caller-supplied targets. Activation uses document-bound script injection and messages. Other frames, native-page senders and stale documents cannot use it to activate a different page. Existing diagnostics, downloads, verification, deletion and full model-status APIs stay restricted to extension-owned UI pages. Page-origin privileged requests and synthetic DOM events are rejected in browser tests.

Image acquisition now attaches owning tab/document identifiers to its short-lived pending-host record. The page menu only receives a host belonging to its current document. Settings retains explicit named-host consent: `chrome.permissions.request()` runs directly from its own trusted button click. There is no forwarded automatic grant and no extra manifest permission, public web-accessible resource or automatic content-script registration.

## Limits and evidence

Injected UI is part of the host document. Page scripts can observe its visible menu state/language choices and translation DOM; the packaged privacy notice describes this. Shadow DOM isolates styling rather than providing a security boundary against the host page. Privileged model management and native permission consent remain outside that document.

The new panel has its own `test:menu` suite. Other page suites explicitly dismiss the menu after granting activeTab, then run their existing real OCR/translation journeys. `test:popup` is retained as a legacy extension-UI regression and sets a native popup only in its disposable profile. No normal toolbar action uses that native popup.

See [the 0.8.0 QA evidence](evidence/floating-menu/QA.md) for actual page captures, transparent-corner checks, fixture labels, scoped accessibility results and manual/device limitations. The original [design contract](POPUP_UI.md) records the user-approved direction. Reload the extension and refresh existing webpages before trying **Preview · 0.8.0**.

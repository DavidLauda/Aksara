# Popup and translated-text consistency — design contract

Reference: the user's two screenshots. The translated regions still use 2 px square-looking corners, while the toolbar uses rounded pale surfaces. The Chrome action popup has collapsed into a narrow scrolling column, with repeated explanatory copy pushing the main action out of view.

The reader's job is to choose source/target languages and enable image translation for the page. Use a calm, compact utility surface: Aksara wordmark and Local badge, side-by-side From/To native selects, one site-access switch with its hostname, one primary activation action, and a short model-state row opening Settings. Privacy and the preview version belong in a small footer. Retain explicit model download consent on the existing Setup page. Routine saved/status explanations are announced without occupying the normal popup; recovery messages remain visible.

Give the popup document an explicit 360 px width independent of its initial viewport, with ordinary content fitting below 600 px. Test the browser-created action popup itself, rather than relying only on a full browser tab. Long hosts, partial/missing/error model states and denied site access must fit without horizontal overflow. Test standalone extension documents at 375×812, 768×900 and 1440×900 as well as the actual popup at its intrinsic width. Inspect 125% text sizing and reduced transparency/forced colors. Use existing native controls, named labels, visible focus and at least 36 px primary control targets.

Continue the toolbar's green ink, neutral glass tint, rounded edges and hairline highlight. Chrome's popup is a separate document: CSS cannot sample the webpage behind its window. Use static translucent gradients/highlights inside the popup to match the visual language, with opaque accessibility fallbacks and no decorative animation or new package. Translation regions use the same 16 px corner family, pale opaque backing and gentle outline; padding must protect glyphs at the corners. No blur is added per text region.

| State | Feedback and next action |
|---|---|
| Loading | Disabled selects/activation until local preferences are read; short model check. |
| Empty | Model setup needed; Settings/Set up opens existing consent flow. |
| Error | Specific saved-preference/activation/model error and a retry/setup path. |
| Partial | Incomplete model download stays explicit; resume through Setup. |
| Success | Concise ready state and activation confirmation pointing to image Translate buttons. |
| Permission | Site switch controls the exact displayed origin; denied image-host access retains its explicit grant button; unsupported browser pages explain how to return to a website. |

Run production build, unit/distribution checks, focused popup/rendering checks, and affected existing browser journeys. Preserve artifacts with clear replay/native-popup labels; unavailable native dialog or screen-reader checks remain untested, and pixel regression remains inconclusive without an approved matching baseline.

## Result and protocol detail

Version 0.7.1 gives the normal native popup a measured 360×448 px footprint. The reproduced pre-fix action window was 146 px wide, with an 873 px document constrained to a 510 px view. `test:popup` uses Chrome's real action popup and direct CDP input/inspection because these views are not automatically exposed as Playwright Pages. Model/loading state replays use separately labeled extension tabs at the same width. Permission content may require normal vertical scrolling in a shorter Chrome popup; it does not introduce horizontal overflow.

The existing `AKSARA_PING` reply now includes `controlsEnabled`, a boolean from the content script's actual site/activation state. The popup uses it to display Enabled on this page after reopening. A remaining content-script listener alone does not count as activation: disabling and allowing a site still requires the user's explicit Enable translation action. The ping contains no pixels or recognized text and starts no inference.

The [QA record](evidence/popup-ui/QA.md) separates actual native-window checks, UI-state fixtures and real OCR/NLLB overlay checks. Reload the unpacked extension and refresh existing webpages to pick up the new popup and text styling.

## Surface cleanup — 0.7.2

The next screenshot identifies the rectangular outer plate around the rounded popup. Remove the document/body background, 8 px outside padding and exterior shadow, letting the rounded surface meet the popup bounds. Keep its inner content padding and the existing accessible controls. Remove the Local badge and its unused styles. Chrome owns the native window/compositor, so document transparency must not be described as guaranteed transparency through to the webpage. Verify the actual action view, its recovery states, and the existing responsive/accessibility checks.

Implemented and verified in the actual Chrome action view: normal footprint 360×430 px, with no horizontal or vertical overflow. Production build, 100 unit tests and all nine popup browser cases pass. See [the cleanup evidence](evidence/popup-surface-cleanup/QA.md).

## Floating menu — 0.8.0 contract

The user clarified that the webpage must show through outside the rounded card, and selected an in-page floating panel. The toolbar action now opens a top-right menu inside the active HTTP(S) document. Use a Shadow DOM and the Popover API's top layer with a transparent backdrop, a single 22 px rounded surface, and no surrounding rectangular paint. Retain the language/site/activation/settings flow and the removed Local badge. Add a labeled Close button; Escape, outside click and another toolbar click dismiss the menu. Preserve image translations when reopening. Ordinary page activation still requires the explicit Enable action, and no pixels are acquired when opening the menu.

Use the shared popup markup/style rather than a second independently styled form. Clamp width to 360 px and the visual viewport, allow vertical scrolling on short pages, keep native fields/keyboard focus and opaque/forced-color fallbacks. Test at 375×812, 768×900 and 1440×900, including click-through outside the curved corners. A browser-created native popup must not open on normal websites. On restricted browser pages, the toolbar opens extension Settings instead.

The page menu gets only a compact read-only readiness summary and document-bound image-control activation from the background. Source URLs/tab IDs come from Chrome's sender metadata, and the current document/site preference is rechecked. Existing diagnostics, downloads, verification and deletion stay restricted to extension-owned pages. Image-host consent moves to a visible section in Settings where chrome.permissions.request runs directly in a trusted click. No new manifest permissions, web-accessible resources, page pixel collection or inference start are needed for menu opening. Test synthetic page events and privileged-message rejection.

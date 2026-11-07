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

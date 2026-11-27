# Edge Lab reference implementation — design QA

## Scope and result

**passed**

Implemented the supplied player-card and dashboard reference in the existing
Edge Lab frontend. This assessment covers the NBA landing board, expanded exact
quote cards, the research board, shared navigation, and responsive behavior.
The implementation uses the existing data and decision contracts.

## Reference and comparison setup

- Original user reference: `IMG_7228.png`, 1320 × 2868 pixels.
- Source file: `/workspace/scratch/9f8883c7bb0c/upload/IMG_7228.png`.
- Source attachment identity: `libfile_fde3_f-82f81a3e840081918056635ecd906c64_f9cfd038890481918dca787870439367`.
- The reference is an iPhone screenshot containing two app mockups. ChatGPT
  controls, iOS status indicators, surrounding explanatory text, and the chat
  input are outside the implementation scope.
- Source normalization: three bitmap pixels to one CSS pixel. The detail crop
  is 1224 × 940 bitmap pixels, rendered at 408 × 313⅓ CSS pixels. The dashboard
  crop is shown at its original one-third scale, ending before the chat input.
- Comparison used the actual application in a browser iframe, beside the
  source crop in the **same screenshot**. App styles were not overridden by
  the comparison wrapper. The wrapper and fixture endpoints are outside the
  repository and are not shipped to production.
- Browser captures were taken at one screenshot pixel per CSS pixel. For the
  detail comparison, a 455px iframe has a measured 440px layout viewport and a
  15px scrollbar; the card occupies 406px after the app's horizontal padding
  and outer disclosure borders. The reference card is approximately 407–408px.
- For the full dashboard comparison, a 423px iframe gives a measured 408px
  layout viewport, matching the reference dashboard's full width. Both
  dashboard interiors have 16px horizontal padding.
- Both comparison panels show the same state: NBA Props, with a separate
  detail comparison opened to Derrick White / Over 3.5 rebounds / DraftKings
  +123 / AVOID / unavailable estimates. Fixtures are explicitly labeled
  synthetic; no test quote, player availability, or model approval is live.

## Evidence

Internal browser captures, inspected directly:

| Evidence | File |
| --- | --- |
| Initial detail comparison | `/workspace/shared/edge-card-before.jpg` |
| Final source and implemented detail together | `/workspace/shared/edge-card-final.jpg` |
| Initial dashboard comparison | `/workspace/shared/edge-dashboard-before.jpg` |
| Final source and implemented dashboard together | `/workspace/shared/edge-dashboard-final.jpg` |
| Narrow phone and long player name | `/workspace/shared/edge-mobile-320.jpg` |
| Research interaction check | `/workspace/shared/edge-research-interactions.jpg` |
| Final research board/card | `/workspace/shared/edge-research-final.jpg` |
| Desktop board | `/workspace/shared/edge-desktop-final.jpg` |

The full dashboard and complete expanded card were compared as whole views.
Focused review covered the portrait/name/selection area, metric divider and
columns, reason strip, details link, tabs, status tiles, heading, and player row.

## Findings, fixes, and post-fix evidence

| Finding | Severity | Resolution and verification |
| --- | --- | --- |
| Prior interface did not reproduce the supplied composition | P1 | Replaced the default expanded-card grid with compact player/market disclosure rows and a shared EDGE LAB shell. Final dashboard comparison shows the intended hierarchy. |
| First target card was 344.89px high versus roughly 313px in the source | P2 | Adjusted headline, selection, book, metric, reason, and disclosure spacing. The final measured height is **313.23px** at a 406px card width. |
| Sport tabs were stretched across the full width | P2 | Changed to compact pills with the reference's natural widths and spacing. Final full-dashboard comparison confirms the proportions. |
| Header and board spacing pushed the first player too far down | P2 | Reduced header spacing and board-heading height. The first row aligns closely with the source at the normalized dashboard width. |
| Share/query parameters removed the active Props pill | P2 | Active-link matching now compares only the parameters that select a board (`kind`, `sport`). The rendered Props pill is selected in the comparison. |
| Research retained controls above the player list | P2 | Search, sorting, shortlist, and filters now open from a filter icon. Coverage and status details sit below the rows. Browser verified default hidden state and retained filters. |
| Research inserted a second disclosure chevron | P2 | Hid the duplicate image; the shared official Heroicons chevron renders once. Browser computed display check confirmed the duplicate is hidden. |
| Expanded research group repeated the large name above the portrait | P2 | Open rows show “Back to players” / “Back to markets”; the portrait card has the visible full heading. Browser confirmed one visible Derrick White heading. |
| The original small AVOID badge color was slightly below 4.5:1 contrast | P2 | Lightened the red to `#ff6258` on `#3a2322` while keeping the supplied visual treatment. |
| Refresh ordering could move a viewed exact quote under closed additional quotes | P1 | Preserve visibly expanded/focused quotes and open their additional-quote ancestor when reordering moves them. Unvisited and explicitly closed groups stay collapsed. Regression tests cover both cases. |
| Research headline omitted the calendar day for tomorrow's events | P1 | Non-today Central dates include month/day. Tests include the UTC/Central midnight boundary. |
| Header refresh did not immediately refetch reviewed decisions | P2 | The same refresh control now invokes the existing live-board refresh, in addition to its existing quote handler. No new polling timer was added. |

No unresolved P0, P1, or P2 design/interaction finding remains in the reviewed
scope. P3 differences: current verified official portraits can differ in pose
from the older portrait in the reference; functioning status tiles display real
counts rather than copying the mockup's placeholder dashes. WATCH stays a dash
when the source supplies no watch decisions. Research quotes retain their
truthful NOT CLEARED/UNAVAILABLE labels and available market estimates.

## Visual surfaces checked

- **Typography:** full names are primary, 22px on mobile detail cards and 18px
  in compact rows. Names wrap without ellipsis; provider identifiers remain in
  expanded evidence. Selection, book/price, and metadata have distinct sizes
  and weights. Long names remain readable in the narrowest checked viewport.
- **Spacing and shape:** 16px card radius, 64px mobile portrait, thin neutral
  divider, plain three-column metrics, muted reason strip, and compact purple
  disclosure match the source. Desktop retains the hierarchy in a centered
  860px maximum-width app, with larger portrait/padding where appropriate.
- **Color:** neutral `#1c1c1c` surfaces, `#24252c` tiles, `#25252c` reason strip,
  `#2a2a2a` selected pills, white names, `#afafaf` metadata, and `#c1b5f8` details
  links. Removed the previous page gradient and prominent purple tab borders.
- **Assets:** real, identity-matched portraits; bundled White, Pritchard, and
  Tatum assets; official ESPN URLs for other verified mappings; neutral user
  icon fallback for unknown/conflicting identities or failed images. Icons
  are unmodified Heroicons assets with their upstream license and provenance.
- **Content:** one group per player/event/market/scope; exact sides, books,
  alternate lines, model evaluations, and history remain separately inspectable.
  Unavailable values show N/A; no mockup probability is manufactured.

## Browser interaction and responsive checks

- Default collapsed player rows, pointer activation, and keyboard Enter to
  expand the selected player.
- NBA filter icon, search, side filtering, closing/reopening filters, and one
  matching player group for Derrick White. Under selection retained the exact
  -163 quote, independently of Over +123.
- Expanded research/model evidence and exact-quote actions remained available.
- Manual refresh preserved the open player, open evidence, and selected side.
- Research filter panel defaults hidden, focuses Search on opening, and keeps
  the search after closing. Search still produces one matching group.
- Research “Why isn't this cleared?” modal showed the exact quote and complete
  evidence; close control worked. Shortlisting changed the action to Remove
  saved; saved state and disclosures survived refresh.
- Menu opens, Escape closes it and restores its control, advanced dashboard
  routes remain accessible, and Performance selects the expected section.
- Root URL redirects to `/nba.html`. NFL navigation reaches its existing
  research-only model page. No unsupported sport model was manufactured.
- 320px phone frame: measured layout and scroll width both **305px** after the
  scrollbar. Giannis Antetokounmpo wraps into two readable lines; no element
  exceeds the layout viewport.
- 390px phone frame: measured layout and scroll width both **375px**; research
  card, controls, and portrait fit without horizontal overflow.
- 423px dashboard comparison: layout and scroll width both **408px**.
- 455px detail comparison: layout width **440px**, reference-sized card.
- Desktop: document width and scroll width both **1363px**; centered app width
  **860px**.
- Browser console checks found no application errors. Unrelated browser
  extension metadata errors were excluded from app findings.

## Automated verification

- Full Node/API regression suite after the view-state and refresh fixes:
  **757 passed, 0 failed**.
- Focused research tests after the compact filter change: **59 passed**.
- Focused live-card, identity/portrait, and research tests after final view
  edits: **54 passed, 0 failed**.
- Supabase reconstruction secret scan, module/browser-script syntax checks,
  and `git diff --check`: passed.
- Existing browser regression scripts were updated for collapsed groups,
  compact filters, keyboard activation, exact-quote evidence, price checks,
  and disclosure persistence. Their remote CI outcome is reported separately
  in the pull request and should not be inferred from this local visual check.

## Final status

passed

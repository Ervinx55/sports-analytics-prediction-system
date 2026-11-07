# Edge Lab research platform design

Approved direction: user approved the proposed prop-research platform on October 25, 2026. Build on existing Edge Lab rather than replace the prediction or private account services.

## Approach
Create a unified NBA/NFL research board first, reusing existing APIs and plain browser modules. This makes current evidence searchable immediately and avoids coupling a visual redesign to unearned model influence. A full application rewrite would delay the existing accounting work; a cosmetic restyle alone would not improve research.

## First release
A new /research.html page with sport tabs, search, market/book filters, freshness states, and detail panels. Display every available exact-book quote, NFL independent estimates, provider timestamps and explicit missing context. Include a session-only research shortlist; this is not a wager or a persisted pregame prediction. Link existing performance tracking and private Accounts & Profit. Keep historical research charts unavailable until an actual validated game-log source is wired in.

## Constraints
No paid dependencies or new provider purchases. No copied branding, invented hit rates, grades or injury information. NBA quote-only rows never become predictions; NFL remains shadow-only. Preserve current production gates. No model decision changes. Private account activation and read-only Kalshi work remain separate unfinished work.

## Subsequent releases
Verified player game logs and context, durable authenticated saved picks tied to settlement, and broader NHL/tennis/soccer coverage. These require source and persistence validation; the first board must not imply they are already implemented.

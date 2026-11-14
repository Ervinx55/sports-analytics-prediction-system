# Sharp books in NBA research

This change extends the research collector shipped in PR #60. It does not install
a second collector or endpoint. The research UI continues to use
`/api/nbaprops?view=research`; default `/api/nbaprops` remains the frozen DraftKings
validation feed. PR #59 provider aliases and circuit handling remain unchanged.

Research now requests Pinnacle (`pinnacle`), Circa (`circa`), and BookMaker.eu
(`bookmakereu`) alongside DraftKings, Bovada, PrizePicks, Underdog and Kalshi.
Sharp sportsbook quotes use the same strict roster, exact-line, availability and
five-minute freshness checks as existing sportsbook research. Book chance requires
fresh opposing prices at the same book and line; it is not a validated prediction.
DFS payout worksheets, exchange limitations and all production/model gates remain
unchanged. No line availability or price comparison clears a play.

One combined filter is used, not one request per book. The shared object optimizer
uses background priority and a two-page fanout. Each page remains capped at 16
events, with smaller limits under quota pressure. Exhausted quota stops quote
requests and the UI explains the quota blocker. No polling interval is increased.

Coverage reports returned research lines only. A book not observed is not proof
of entitlement or lack of entitlement. Team-market coverage is not prop coverage.
No live sharp player-prop coverage is claimed from synthetic tests.

Tests cover expanded requests, sharp exact-line price pairs, unchanged frozen feed,
quota bounds and failure, plus the existing PR #60 platform/normalization checks.
The mobile browser fixture covers sharp coverage/filtering, DFS probability absence,
worksheet repeat/edit invalidation, modal close, shortlist, sport switching and
refresh. Current-head CI status is recorded in PR #58. No merge/deploy is authorized
by these checks alone.

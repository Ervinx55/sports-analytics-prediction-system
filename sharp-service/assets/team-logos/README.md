# Team logos

NBA logos are bundled unchanged from the authentic ESPN team-logo CDN. Other
teams use exact logo URLs published in ESPN's current league team directories.
`SOURCES.json` records the directory snapshot, original asset URLs and SHA-256
checksums for the bundled images. These marks remain the property of their teams.

The display registry is `sharp-service/team-registry.js`. It uses exact,
sport-scoped names and abbreviations; aliases shared by different teams are
deliberately unresolved. College-football coverage includes directory entries
with a standard verified logo URL. Unrecognized names and failed image loads
retain readable names and an initials badge.

This is a visual identity registry only. It does not modify provider IDs,
betting selections, event matching, probabilities or approvals. Refresh from the
recorded primary team-directory sources when a team name or logo changes.

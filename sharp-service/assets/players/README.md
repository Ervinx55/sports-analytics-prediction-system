# Player portraits

Real player headshots come from the official ESPN roster API and ESPN image CDN.
`SOURCES.json` records each exact provider ID, official athlete ID, name, roster
source, and portrait URL. The Derrick White, Payton Pritchard, and Jayson Tatum
files are unmodified copies of those official PNGs for the supplied design.
Other verified portraits load directly from the official CDN.

This mapping was verified on November 27, 2026. It is a presentation lookup,
not a roster, event-identity, injury, or betting clearance source. Unknown IDs
and failed image loads use the vendored Heroicons user outline; no initials or
generated faces are substituted. Names are not matched at runtime. URLs from
live data cannot redirect a player's image to an unverified athlete or host.

Portrait copyrights remain with their respective rights holders; the MIT
license in `../icons` applies only to the Heroicons SVG assets.

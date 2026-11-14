// Explicitly reviewed evidence; never infer identities or widen kickoff tolerances.
export const reviewedTeams=[{
 season:2026,sgoTeamID:'APPALACHIAN_STATE_NCAAF',espnTeamID:'2026',
 sgoNames:['Appalachian State','Appalachian St.'],espnNames:['App State','App State Mountaineers'],
 reviewedAt:'2026-11-14T16:46:00Z',
 sources:['https://appstatesports.com/sports/football/schedule/2026','https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/2026/schedule?season=2026']
}];
export const reviewedKickoffs=[{
 season:2026,sgoEventID:'BKBP22DuBmOzmKmFX6FO',espnEventID:'401864537',
 sgoHomeID:'HAWAII_NCAAF',sgoAwayID:'NORTH_DAKOTA_STATE_NCAAF',espnHomeID:'62',espnAwayID:'2449',
 providerStartsAt:'2026-11-15T03:00:00Z',verifiedStartsAt:'2026-11-15T04:00:00Z',
 reviewedAt:'2026-11-14T16:46:00Z',status:'OFFICIAL_SCHEDULE_VERIFIED_PROVIDER_CONFLICT',
 sources:['https://hawaiiathletics.com/sports/football/schedule/2026','https://gobison.com/news/2026/11/10/football-bison-travel-to-hawaii-for-saturday-night-matchup-on-the-cw'],
 explanation:'Hawaii lists 6:00 p.m. HST; NDSU lists 6:10 p.m. HST. Both support the ESPN 04:00 UTC scheduled window, not the provider 03:00 UTC time. Research uses the scheduled time; book comparison remains blocked until times agree.'
}];

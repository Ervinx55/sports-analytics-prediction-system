import {handleNbaOutcomeSourceRequest} from '../../../scripts/nba/outcome-source-audit.mjs';

// Deploy with verify_jwt=true. This function never reads/writes the database.
Deno.serve(req=>handleNbaOutcomeSourceRequest(req,{
  apiKey:Deno.env.get('SPORTS_ODDS_API_KEY')||Deno.env.get('Sports_Game_Odds_API')||''
}));


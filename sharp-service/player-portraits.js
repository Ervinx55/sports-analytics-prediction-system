// Exact provider IDs paired with official ESPN roster identities on 2026-11-27.
// See assets/players/SOURCES.json for the paired sources. Photos are presentation
// only: this module does not verify event eligibility, team, injury, or decisions.
const VERIFIED_PORTRAITS = Object.freeze({
  "AARON_GORDON_1_NBA": Object.freeze(["3064290", "Aaron Gordon"]),
  "AARON_NESMITH_1_NBA": Object.freeze(["4396909", "Aaron Nesmith"]),
  "AARON_WIGGINS_1_NBA": Object.freeze(["4397183", "Aaron Wiggins"]),
  "AIRIOUS_BAILEY_1_NBA": Object.freeze(["4873138", "Ace Bailey"]),
  "ALLEN_GRAVES_1_NBA": Object.freeze(["5149115", "Allen Graves"]),
  "ANDREW_NEMBHARD_1_NBA": Object.freeze(["4395712", "Andrew Nembhard"]),
  "ANDREW_WIGGINS_1_NBA": Object.freeze(["3059319", "Andrew Wiggins"]),
  "ANFERNEE_SIMONS_1_NBA": Object.freeze(["4351851", "Anfernee Simons"]),
  "AUSAR_THOMPSON_1_NBA": Object.freeze(["4684742", "Ausar Thompson"]),
  "AUSTIN_REAVES_1_NBA": Object.freeze(["4066457", "Austin Reaves"]),
  "AYO_DOSUNMU_1_NBA": Object.freeze(["4397002", "Ayo Dosunmu"]),
  "BAM_ADEBAYO_1_NBA": Object.freeze(["4066261", "Bam Adebayo"]),
  "BAYLOR_SCHEIERMAN_1_NBA": Object.freeze(["4593841", "Baylor Scheierman"]),
  "BOBBY_PORTIS_1_NBA": Object.freeze(["3064482", "Bobby Portis"]),
  "BONES_HYLAND_1_NBA": Object.freeze(["4592492", "Bones Hyland"]),
  "BRANDIN_PODZIEMSKI_1_NBA": Object.freeze(["4709138", "Brandin Podziemski"]),
  "BRANDON_INGRAM_1_NBA": Object.freeze(["3913176", "Brandon Ingram"]),
  "BRAYDEN_BURRIES_1_NBA": Object.freeze(["5082206", "Brayden Burries"]),
  "BRICE_SENSABAUGH_1_NBA": Object.freeze(["5105839", "Brice Sensabaugh"]),
  "BROOK_LOPEZ_1_NBA": Object.freeze(["3448", "Brook Lopez"]),
  "CALEB_MARTIN_1_NBA": Object.freeze(["3138160", "Caleb Martin"]),
  "CAMERON_JOHNSON_1_NBA": Object.freeze(["3138196", "Cameron Johnson"]),
  "CAM_SPENCER_1_NBA": Object.freeze(["4433083", "Cam Spencer"]),
  "CEDRIC_COWARD_1_NBA": Object.freeze(["4903027", "Cedric Coward"]),
  "CHARLES_BASSEY_1_NBA": Object.freeze(["4397886", "Charles Bassey"]),
  "CHRISTIAN_BRAUN_1_NBA": Object.freeze(["4431767", "Christian Braun"]),
  "COLLIN_GILLESPIE_1_NBA": Object.freeze(["4278585", "Collin Gillespie"]),
  "COLLIN_MURRAYBOYLES_1_NBA": Object.freeze(["5093267", "Collin Murray-Boyles"]),
  "COLLIN_SEXTON_1_NBA": Object.freeze(["4277811", "Collin Sexton"]),
  "C_FLAGG_1_NBA": Object.freeze(["5041939", "Cooper Flagg"]),
  "DAMIAN_LILLARD_1_NBA": Object.freeze(["6606", "Damian Lillard"]),
  "DANIEL_GAFFORD_1_NBA": Object.freeze(["4278049", "Daniel Gafford"]),
  "DANIEL_WOLF_1_NBA": Object.freeze(["5107173", "Danny Wolf"]),
  "DANISS_JENKINS_1_NBA": Object.freeze(["5107199", "Daniss Jenkins"]),
  "DARIUS_GARLAND_1_NBA": Object.freeze(["4396907", "Darius Garland"]),
  "DARRYN_PETERSON_1_NBA": Object.freeze(["5041955", "Darryn Peterson"]),
  "DAVION_MITCHELL_1_NBA": Object.freeze(["4278053", "Davion Mitchell"]),
  "DAYRON_SHARPE_1_NBA": Object.freeze(["4432194", "Day'Ron Sharpe"]),
  "DEAARON_FOX_1_NBA": Object.freeze(["4066259", "De'Aaron Fox"]),
  "DEANTHONY_MELTON_1_NBA": Object.freeze(["4066436", "De'Anthony Melton"]),
  "DEAN_WADE_1_NBA": Object.freeze(["3912848", "Dean Wade"]),
  "DEMAR_DEROZAN_1_NBA": Object.freeze(["3978", "DeMar DeRozan"]),
  "DENI_AVDIJA_1_NBA": Object.freeze(["4683021", "Deni Avdija"]),
  "DERIK_QUEEN_1_NBA": Object.freeze(["4869780", "Derik Queen"]),
  "DERRICK_JONES_JR_1_NBA": Object.freeze(["3936099", "Derrick Jones Jr."]),
  "DERRICK_WHITE_1_NBA": Object.freeze(["3078576", "Derrick White"]),
  "DEVIN_BOOKER_1_NBA": Object.freeze(["3136193", "Devin Booker"]),
  "DEVIN_VASSELL_1_NBA": Object.freeze(["4395630", "Devin Vassell"]),
  "DILLON_BROOKS_1_NBA": Object.freeze(["3155526", "Dillon Brooks"]),
  "DONOVAN_CLINGAN_1_NBA": Object.freeze(["5105565", "Donovan Clingan"]),
  "DRAYMOND_GREEN_1_NBA": Object.freeze(["6589", "Draymond Green"]),
  "DYSON_DANIELS_1_NBA": Object.freeze(["4869342", "Dyson Daniels"]),
  "EGOR_DEMIN_1_NBA": Object.freeze(["5175643", "Egor Demin"]),
  "GIANNIS_ANTETOKOUNMPO_1_NBA": Object.freeze(["3032977", "Giannis Antetokounmpo"]),
  "GUI_SANTOS_1_NBA": Object.freeze(["4997536", "Gui Santos"]),
  "IMMANUEL_QUICKLEY_1_NBA": Object.freeze(["4395724", "Immanuel Quickley"]),
  "ISAIAH_JOE_1_NBA": Object.freeze(["4395702", "Isaiah Joe"]),
  "IVICA_ZUBAC_1_NBA": Object.freeze(["4017837", "Ivica Zubac"]),
  "JADEN_MCDANIELS_1_NBA": Object.freeze(["4431671", "Jaden McDaniels"]),
  "JAIME_JAQUEZ_JR_1_NBA": Object.freeze(["4432848", "Jaime Jaquez Jr."]),
  "JAKE_LARAVIA_1_NBA": Object.freeze(["4592691", "Jake LaRavia"]),
  "JAKOBE_WALTER_1_NBA": Object.freeze(["4684272", "Ja'Kobe Walter"]),
  "JAKOB_POELTL_1_NBA": Object.freeze(["3134908", "Jakob Poeltl"]),
  "JALEN_BRUNSON_1_NBA": Object.freeze(["3934672", "Jalen Brunson"]),
  "JALEN_GREEN_1_NBA": Object.freeze(["4437244", "Jalen Green"]),
  "JALEN_JOHNSON_1_NBA": Object.freeze(["4701230", "Jalen Johnson"]),
  "JAMAL_MURRAY_1_NBA": Object.freeze(["3936299", "Jamal Murray"]),
  "JAMAL_SHEAD_1_NBA": Object.freeze(["4432241", "Jamal Shead"]),
  "JAVONTE_GREEN_1_NBA": Object.freeze(["2596112", "Javonte Green"]),
  "JAXSON_HAYES_1_NBA": Object.freeze(["4397077", "Jaxson Hayes"]),
  "JAYLEN_WELLS_1_NBA": Object.freeze(["5112087", "Jaylen Wells"]),
  "JAYSON_TATUM_1_NBA": Object.freeze(["4065648", "Jayson Tatum"]),
  "JEREMIAH_FEARS_1_NBA": Object.freeze(["5144091", "Jeremiah Fears"]),
  "JOAN_BERINGER_1_NBA": Object.freeze(["5279133", "Joan Beringer"]),
  "JOEL_EMBIID_1_NBA": Object.freeze(["3059318", "Joel Embiid"]),
  "JOHN_COLLINS_1_NBA": Object.freeze(["3908845", "John Collins"]),
  "JONATHAN_KUMINGA_1_NBA": Object.freeze(["4433247", "Jonathan Kuminga"]),
  "JORDAN_GOODWIN_1_NBA": Object.freeze(["4278402", "Jordan Goodwin"]),
  "JORDAN_POOLE_1_NBA": Object.freeze(["4277956", "Jordan Poole"]),
  "JOSH_GREEN_1_NBA": Object.freeze(["4432811", "Josh Green"]),
  "JOSH_HART_1_NBA": Object.freeze(["3062679", "Josh Hart"]),
  "JRUE_HOLIDAY_1_NBA": Object.freeze(["3995", "Jrue Holiday"]),
  "JULIAN_CHAMPAGNIE_1_NBA": Object.freeze(["4592479", "Julian Champagnie"]),
  "JULIUS_RANDLE_1_NBA": Object.freeze(["3064514", "Julius Randle"]),
  "JUSUF_NURKIC_1_NBA": Object.freeze(["3102530", "Jusuf Nurkic"]),
  "KARLANTHONY_TOWNS_1_NBA": Object.freeze(["3136195", "Karl-Anthony Towns"]),
  "KELEL_WARE_1_NBA": Object.freeze(["5105623", "Kel'el Ware"]),
  "KELLY_OUBRE_JR_1_NBA": Object.freeze(["3133603", "Kelly Oubre Jr."]),
  "KENTAVIOUS_CALDWELLPOPE_1_NBA": Object.freeze(["2581018", "Kentavious Caldwell-Pope"]),
  "KEVIN_HUERTER_1_NBA": Object.freeze(["4066372", "Kevin Huerter"]),
  "KEYONTE_GEORGE_1_NBA": Object.freeze(["4433627", "Keyonte George"]),
  "KINGSTON_FLEMINGS_1_NBA": Object.freeze(["5149077", "Kingston Flemings"]),
  "KLAY_THOMPSON_1_NBA": Object.freeze(["6475", "Klay Thompson"]),
  "KRIS_DUNN_1_NBA": Object.freeze(["2991139", "Kris Dunn"]),
  "KRIS_MURRAY_1_NBA": Object.freeze(["4594326", "Kris Murray"]),
  "KYLE_KUZMA_1_NBA": Object.freeze(["3134907", "Kyle Kuzma"]),
  "KYRIE_IRVING_1_NBA": Object.freeze(["6442", "Kyrie Irving"]),
  "LAMELO_BALL_1_NBA": Object.freeze(["4432816", "LaMelo Ball"]),
  "LANDRY_SHAMET_1_NBA": Object.freeze(["3914044", "Landry Shamet"]),
  "LEBRON_JAMES_1_NBA": Object.freeze(["1966", "LeBron James"]),
  "LUGUENTZ_DORT_1_NBA": Object.freeze(["4397020", "Luguentz Dort"]),
  "LUKA_DONCIC_1_NBA": Object.freeze(["3945274", "Luka Doncic"]),
  "MATISSE_THYBULLE_1_NBA": Object.freeze(["3907498", "Matisse Thybulle"]),
  "MAX_STRUS_1_NBA": Object.freeze(["4065778", "Max Strus"]),
  "MICHAEL_PORTER_JR_1_NBA": Object.freeze(["4278104", "Michael Porter Jr."]),
  "MIKAL_BRIDGES_1_NBA": Object.freeze(["3147657", "Mikal Bridges"]),
  "MIKEL_BROWN_JR_1_NBA": Object.freeze(["5101761", "Mikel Brown Jr."]),
  "MILES_BRIDGES_1_NBA": Object.freeze(["4066383", "Miles Bridges"]),
  "MYLES_TURNER_1_NBA": Object.freeze(["3133628", "Myles Turner"]),
  "NAJI_MARSHALL_1_NBA": Object.freeze(["4278594", "Naji Marshall"]),
  "NATE_AMENT_1_NBA": Object.freeze(["5164559", "Nate Ament"]),
  "NEEMIAS_QUETA_1_NBA": Object.freeze(["4397424", "Neemias Queta"]),
  "NICKEIL_ALEXANDERWALKER_1_NBA": Object.freeze(["4278039", "Nickeil Alexander-Walker"]),
  "NIKOLA_JOKIC_1_NBA": Object.freeze(["3112335", "Nikola Jokic"]),
  "NOAH_CLOWNEY_1_NBA": Object.freeze(["4712896", "Noah Clowney"]),
  "OBI_TOPPIN_1_NBA": Object.freeze(["4278355", "Obi Toppin"]),
  "ONYEKA_OKONGWU_1_NBA": Object.freeze(["4431680", "Onyeka Okongwu"]),
  "OSO_IGHODARO_1_NBA": Object.freeze(["4601023", "Oso Ighodaro"]),
  "PASCAL_SIAKAM_1_NBA": Object.freeze(["3149673", "Pascal Siakam"]),
  "PAUL_GEORGE_1_NBA": Object.freeze(["4251", "Paul George"]),
  "PAUL_REED_1_NBA": Object.freeze(["4278562", "Paul Reed"]),
  "PAYTON_PRITCHARD_1_NBA": Object.freeze(["4066354", "Payton Pritchard"]),
  "PELLE_LARSSON_1_NBA": Object.freeze(["4601025", "Pelle Larsson"]),
  "QUENTIN_GRIMES_1_NBA": Object.freeze(["4397014", "Quentin Grimes"]),
  "RUDY_GOBERT_1_NBA": Object.freeze(["3032976", "Rudy Gobert"]),
  "RUI_HACHIMURA_1_NBA": Object.freeze(["4066648", "Rui Hachimura"]),
  "RYAN_ROLLINS_1_NBA": Object.freeze(["4591725", "Ryan Rollins"]),
  "SADDIQ_BEY_1_NBA": Object.freeze(["4397136", "Saddiq Bey"]),
  "SAM_HAUSER_1_NBA": Object.freeze(["4065804", "Sam Hauser"]),
  "SCOOT_HENDERSON_1_NBA": Object.freeze(["4683678", "Scoot Henderson"]),
  "SCOTTIE_BARNES_1_NBA": Object.freeze(["4433134", "Scottie Barnes"]),
  "SIDY_CISSOKO_1_NBA": Object.freeze(["5081727", "Sidy Cissoko"]),
  "SPENCER_JONES_1_NBA": Object.freeze(["4592427", "Spencer Jones"]),
  "STEPHON_CASTLE_1_NBA": Object.freeze(["4845367", "Stephon Castle"]),
  "TERRENCE_SHANNON_1_NBA": Object.freeze(["4432847", "Terrence Shannon Jr."]),
  "TOUMANI_CAMARA_1_NBA": Object.freeze(["4431736", "Toumani Camara"]),
  "TREY_LYLES_1_NBA": Object.freeze(["3136196", "Trey Lyles"]),
  "TREY_MURPHY_III_1_NBA": Object.freeze(["4397688", "Trey Murphy III"]),
  "TYLER_HERRO_1_NBA": Object.freeze(["4395725", "Tyler Herro"]),
  "TYRESE_MAXEY_1_NBA": Object.freeze(["4431678", "Tyrese Maxey"]),
  "TY_JEROME_1_NBA": Object.freeze(["4065733", "Ty Jerome"]),
  "VICTOR_WEMBANYAMA_1_NBA": Object.freeze(["5104157", "Victor Wembanyama"]),
  "VJ_EDGECOMBE_1_NBA": Object.freeze(["5124612", "VJ Edgecombe"]),
  "WALKER_KESSLER_1_NBA": Object.freeze(["4433136", "Walker Kessler"]),
  "YAXEL_LENDEBORG_1_NBA": Object.freeze(["5175737", "Yaxel Lendeborg"]),
  "YVES_MISSI_1_NBA": Object.freeze(["5061589", "Yves Missi"]),
  "ZACCHARIE_RISACHER_1_NBA": Object.freeze(["5211175", "Zaccharie Risacher"]),
  "ZACH_EDEY_1_NBA": Object.freeze(["4600663", "Zach Edey"]),
  "ZION_WILLIAMSON_1_NBA": Object.freeze(["4395628", "Zion Williamson"]),
});

const LOCAL_PORTRAITS = Object.freeze({
  "DERRICK_WHITE_1_NBA": "/assets/players/derrick-white.png",
  "PAYTON_PRITCHARD_1_NBA": "/assets/players/payton-pritchard.png",
  "JAYSON_TATUM_1_NBA": "/assets/players/jayson-tatum.png"
});
export const PLAYER_PORTRAIT_FALLBACK = '/assets/icons/user.svg';

/** Resolve only a verified exact provider ID. Never infer an athlete from a name.
 * A supplied URL is usable only when it exactly matches that athlete's official
 * verified portrait (or its bundled copy). Unknown IDs cannot claim a portrait.
 */
export function getPlayerPortrait(playerID, suppliedUrl = null) {
  const known = typeof playerID === 'string' &&
    Object.prototype.hasOwnProperty.call(VERIFIED_PORTRAITS, playerID);
  if (!known) return {
    src: PLAYER_PORTRAIT_FALLBACK,
    alt: 'Player portrait unavailable',
    source: 'fallback',
    playerID: typeof playerID === 'string' ? playerID : null,
    fallbackSrc: PLAYER_PORTRAIT_FALLBACK,
  };
  const [athleteID, name] = VERIFIED_PORTRAITS[playerID];
  const officialSrc = `https://a.espncdn.com/i/headshots/nba/players/full/${athleteID}.png`;
  const localSrc = LOCAL_PORTRAITS[playerID];
  const verifiedSupplied = typeof suppliedUrl === 'string' &&
    (suppliedUrl === officialSrc || suppliedUrl === localSrc);
  return {
    src: verifiedSupplied ? suppliedUrl : localSrc || officialSrc,
    alt: `${name} portrait`,
    source: 'espn',
    playerID,
    fallbackSrc: PLAYER_PORTRAIT_FALLBACK,
  };
}

/** Apply a portrait to an existing image, including a one-shot icon fallback. */
export function applyPlayerPortrait(image, playerID, suppliedUrl = null) {
  const portrait = getPlayerPortrait(playerID, suppliedUrl);
  image.alt = portrait.alt;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  if (image.dataset) image.dataset.portraitSource = portrait.source;
  image.onerror = portrait.source === 'fallback' ? null : () => {
    image.onerror = null;
    image.alt = 'Player portrait unavailable';
    if (image.dataset) image.dataset.portraitSource = 'fallback';
    image.src = portrait.fallbackSrc;
  };
  image.src = portrait.src;
  return portrait;
}

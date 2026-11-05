import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
const at=v=>typeof v==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
const identity=p=>JSON.stringify([p.sourceIds?.event,p.marketType,p.side,p.line??null,p.book??null,p.modelVersion]);
const valid=p=>p?.sport==='NBA'&&p.modelMode==='SHADOW'&&p.provenance?.productionWeight===0&&typeof p.sourceIds?.event==='string'&&typeof p.sourceKey==='string'&&p.provenance?.raw?.home&&p.provenance?.raw?.away&&['moneyline','spread','total'].includes(p.marketType)&&Number.isFinite(at(p.capturedAt))&&Number.isFinite(at(p.startsAt))&&Number.isFinite(at(p.provenance.receivedAt));
export function openLocalLedger(path,{clock=()=>new Date().toISOString()}={}){
 const db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;PRAGMA busy_timeout=3000;CREATE TABLE IF NOT EXISTS predictions(id TEXT PRIMARY KEY,identity TEXT UNIQUE NOT NULL,payload TEXT NOT NULL,origin TEXT NOT NULL,stored_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS outcomes(prediction_id TEXT PRIMARY KEY REFERENCES predictions(id),payload TEXT NOT NULL);CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL);');
 const state=key=>{const r=db.prepare('SELECT value FROM state WHERE key=?').get(key);return r?JSON.parse(r.value):null;};
 const set=(key,value)=>db.prepare('INSERT INTO state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
 const insert=(p,origin)=>{if(!valid(p))throw Error('Invalid NBA research snapshot');const key=identity(p),id=createHash('sha256').update(key).digest('hex');return db.prepare('INSERT OR IGNORE INTO predictions VALUES(?,?,?,?,?)').run(id,key,JSON.stringify({...p,id}),origin,clock()).changes===1;};
 return {
 async capture(p){const now=clock(),cutoff=Math.min(at(p.startsAt),at(p.eligibilityStartsAt??p.startsAt));if(!valid(p)||!Number.isFinite(cutoff)||at(now)>=cutoff||at(p.capturedAt)>at(now))return false;return insert({...p,provenance:{...p.provenance,receivedAt:now}},'LOCAL_PROSPECTIVE');},
 importArchive(rows){if(!Array.isArray(rows)||rows.length>10000||rows.some(p=>!valid(p)))throw Error('Invalid NBA archive');db.exec('BEGIN IMMEDIATE');try{let n=0;for(const p of rows)if(insert(p,'IMPORTED_ORIGINAL_FORECAST'))n++;db.exec('COMMIT');return n;}catch(e){db.exec('ROLLBACK');throw e;}},
 async pending(){return db.prepare('SELECT p.payload FROM predictions p LEFT JOIN outcomes o ON o.prediction_id=p.id WHERE o.prediction_id IS NULL ORDER BY p.stored_at,p.id').all().map(r=>JSON.parse(r.payload)).filter(p=>at(p.startsAt)<at(clock())&&at(p.startsAt)>at(clock())-30*86400000).slice(0,250);},
 async settle(s){if(s?.reason!=='RESEARCH_DIRECTION_ONLY'||s.researchOnly!==true||!['WIN','LOSS','PUSH'].includes(s.outcome))throw Error('Invalid research outcome');return db.prepare('INSERT OR IGNORE INTO outcomes VALUES(?,?)').run(s.predictionId,JSON.stringify(s)).changes===1;},
 async cooldown(provider){return (state('cooldown:'+provider)??0)>at(clock());},
 async cool(provider,seconds){set('cooldown:'+provider,Math.max(state('cooldown:'+provider)??0,at(clock())+Math.max(300,Math.min(seconds,2592000))*1000));},
 state,set,
 report(){const rows=db.prepare('SELECT p.payload,p.origin,o.payload outcome FROM predictions p LEFT JOIN outcomes o ON o.prediction_id=p.id ORDER BY p.stored_at DESC,p.id').all().map(r=>({prediction:JSON.parse(r.payload),origin:r.origin,outcome:r.outcome?JSON.parse(r.outcome):null}));const count=v=>rows.filter(r=>r.outcome?.outcome===v).length;return {summary:{saved:rows.length,wins:count('WIN'),losses:count('LOSS'),pushes:count('PUSH'),unresolved:rows.filter(r=>!r.outcome).length,games:new Set(rows.map(r=>r.prediction.eventKey)).size,qualifiedPlays:0,roi:null},lastRun:state('lastRun'),rows:rows.slice(0,500)};},
 close(){db.close();}
 };
}

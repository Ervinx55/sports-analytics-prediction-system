import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);
export {matchOfficialInjury} from './official-injury-match.mjs';
export function officialReportLoader(directory,python=process.env.EDGE_LAB_PYTHON||'python'){
 let lastAttempt=0,lastReport=null;
 return async()=>{if(Date.now()-lastAttempt<900000)return lastReport;lastAttempt=Date.now();
  try{await exec(python,[fileURLToPath(new URL('./official_injury.py',import.meta.url)),directory],{timeout:45000,maxBuffer:100000,windowsHide:true});lastReport=JSON.parse(await readFile(resolve(directory,'latest.json'),'utf8'));}catch{lastReport=null;}
  return lastReport;
 };
}

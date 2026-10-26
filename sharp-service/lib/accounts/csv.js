import {validateEntry} from './accounting.js';
export const IMPORT_COLUMNS=Object.freeze(['id','accountId','source','sourceId','kind','status','sport','description','placedAt','settledAt','stakeCents','returnCents','feeCents','feeIncluded','predictionId','legs','supersedes']);
const error=(row,code,message)=>({row,code,message});
// Reserved canonical text escape: encode the prefix itself to make round trips unambiguous.
const TEXT_PREFIX='csvtext:v1:';
const encodeText=s=>s.startsWith(TEXT_PREFIX)||/^[\s]*[=+\-@\t\r]/.test(s)?TEXT_PREFIX+encodeURIComponent(s):s;
const decodeText=s=>s.startsWith(TEXT_PREFIX)?decodeURIComponent(s.slice(TEXT_PREFIX.length)):s;
/** Canonical imports only. Errors require preview/review; callers must not save partial batches. */
export function parseImportCsv(text){
 if(typeof text!=='string')return {rows:[],errors:[error(0,'invalid_input','CSV text required')]};
 if(new TextEncoder().encode(text).length>1048576)return {rows:[],errors:[error(0,'file_too_large','Maximum UTF-8 size is 1 MiB')]};
 text=text.replace(/^\uFEFF/,'');const matrix=[];let cells=[],cell='',quoted=false,closed=false;
 try{for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}if(c==='"'){if(cell||closed)throw new Error('Unexpected quote');quoted=true;}else if(c===','||c==='\n'||c==='\r'){cells.push(cell);cell='';closed=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;matrix.push(cells);cells=[];if(matrix.length>2001)return {rows:[],errors:[error(0,'too_many_rows','Maximum 2000 data rows')]};}}else{if(closed)throw new Error('Characters after closing quote');cell+=c;}}if(quoted)throw new Error('Unterminated quote');if(cell||cells.length||closed){cells.push(cell);matrix.push(cells);}}
 catch{return {rows:[],errors:[error(matrix.length+1,'malformed_csv','Malformed CSV quoting')]};}
 if(matrix.length>2001)return {rows:[],errors:[error(0,'too_many_rows','Maximum 2000 data rows')]};
 const header=matrix.shift();if(!header||header.length!==IMPORT_COLUMNS.length||header.some((v,i)=>v!==IMPORT_COLUMNS[i]))return {rows:[],errors:[error(1,'unsupported_schema','Use the canonical columns in their documented order')]};
 const rows=[],errors=[],sources=new Set(),ids=new Set();for(let i=0;i<matrix.length;i++){const values=matrix[i],line=i+2;if(values.length!==header.length){errors.push(error(line,'column_count','Incorrect column count'));continue;}const raw=Object.fromEntries(header.map((key,j)=>[key,values[j]]));try{
 for(const key of header)raw[key]=decodeText(raw[key]);
 for(const key of ['stakeCents','returnCents','feeCents']){if(key==='returnCents'&&raw[key]===''){raw[key]=null;continue;}if(!/^(0|[1-9]\d*)$/.test(raw[key]))throw new Error('Money must be nonnegative integer cents');raw[key]=Number(raw[key]);}
 if(!['true','false'].includes(raw.feeIncluded))throw new Error('feeIncluded must be true or false');raw.feeIncluded=raw.feeIncluded==='true';for(const key of ['sourceId','predictionId','supersedes','settledAt'])if(raw[key]==='')raw[key]=null;raw.legs=JSON.parse(raw.legs||'[]');if(raw.source!=='import')throw new Error('CSV source must be import');const normalized=validateEntry(raw);
 if(!normalized.sourceId){errors.push(error(line,'identifier_review_required','Stable sourceId required; review possible duplicates'));continue;}
 const sourceKey=JSON.stringify([normalized.accountId,normalized.source,normalized.sourceId]);if(sources.has(sourceKey)||ids.has(normalized.id)){errors.push(error(line,'duplicate_source_id','Duplicate identifier, including identical rows, requires review'));continue;}sources.add(sourceKey);ids.add(normalized.id);rows.push(normalized);
 }catch{errors.push(error(line,'invalid_row','Invalid entry values; check cents, dates, statuses and identifiers'));}}
 return {rows,errors};
}
/** Reversibly encode formula-like cells and the reserved text prefix. */
export function exportImportCsv(rows){const quote=value=>{let s=value==null?'':typeof value==='object'?JSON.stringify(value):String(value);s=encodeText(s);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};return IMPORT_COLUMNS.join(',')+'\r\n'+rows.map(row=>IMPORT_COLUMNS.map(key=>quote(row[key])).join(',')).join('\r\n')+'\r\n';}


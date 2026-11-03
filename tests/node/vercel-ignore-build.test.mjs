import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../../sharp-service/scripts/ignore-build.mjs',import.meta.url),'utf8').replace("import {spawnSync} from 'node:child_process';",'');
const run=(environment,status)=>{
 let code,calls=0;const exit={};
 try{runInNewContext(source,{console:{log(){}},process:{env:{VERCEL_ENV:environment},exit(value){code=value;throw exit;}},spawnSync(command,args){calls++;assert.equal(command,'git');assert.deepEqual(Array.from(args),['diff','--quiet','HEAD^','HEAD','./']);return {status};}});}catch(error){if(error!==exit)throw error;}
 return {code,calls};
};
test('preview builds without consulting the last-commit diff',()=>{
 assert.deepEqual(run('preview',0),{code:1,calls:0});
});
test('production skips only an unchanged frontend, builds on changes or missing history',()=>{
 assert.deepEqual(run('production',0),{code:0,calls:1});
 for(const status of [1,128,null])assert.deepEqual(run('production',status),{code:1,calls:1});
});

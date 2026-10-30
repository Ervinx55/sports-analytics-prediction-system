import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../../sharp-service/dashboard.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('  function statusBadge(c)'),html.indexOf('  function teamAuditContext'));
function badge(row){return vm.runInNewContext(source+';statusBadge(row)',{row,esc:s=>String(s??'').replaceAll('<','&lt;')});}
test('dashboard makes production decisions actionable and shows recorded issuance',()=>{
 const result=badge({status:'PLAY',tracking:{tracked:true,issuedAt:'2026-10-01T12:34:56Z'}});
 assert.match(result,/PLAY — cleared/);assert.match(result,/Decision issued:/);assert.doesNotMatch(result,/Not recorded/);
 assert.match(badge({status:'PASS'}),/PASS — do not play/);
 assert.match(badge({status:'PLAY',tracking:{tracked:false}}),/NOT CLEARED — do not play/);
 assert.match(badge({status:'PENDING'}),/PENDING — do not play/);
});
test('dashboard never substitutes refresh or quote time for recorded issuance',()=>{
 for(const row of [{status:'PASS',updated_at:'2026-10-01T12:00:00Z'},{status:'PLAY',tracking:{tracked:false,issuedAt:'2026-10-01T12:00:00Z'}},{status:'PASS',tracking:{tracked:true,issuedAt:'<script>bad</script>'}},{status:'PASS',tracking:{tracked:true,issuedAt:'2099-01-01T00:00:00Z'}}])
 assert.match(badge(row),/Decision issued: Not recorded/);
});

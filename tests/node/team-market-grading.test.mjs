import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeMarket } from '../../supabase/functions/_shared/team-market-grading.mjs';

test('missing or malformed total/run lines never become zero-line outcomes',()=>{
  for(const line of [null,undefined,'',' ',NaN,Infinity,true,[]]) {
    assert.equal(gradeMarket({market_type:'total',market_side:'over',line},5,1),null);
    assert.equal(gradeMarket({market_type:'spread',market_side:'away',line},5,1),null);
  }
});
test('valid exact lines preserve win loss and push grading including zero spreads',()=>{
  assert.equal(gradeMarket({market_type:'total',market_side:'under',line:6},5,1).outcome,'PUSH');
  assert.equal(gradeMarket({market_type:'total',market_side:'over',line:'5.5'},5,1).outcome,'W');
  assert.equal(gradeMarket({market_type:'spread',market_side:'home',line:1.5},5,1).outcome,'L');
  assert.equal(gradeMarket({market_type:'spread',market_side:'away',line:0},5,1).outcome,'W');
  assert.equal(gradeMarket({market_type:'moneyline',market_side:'home',line:null},1,5).outcome,'W');
});
test('unknown sides and incomplete final scores cannot be graded',()=>{
  assert.equal(gradeMarket({market_type:'moneyline',market_side:'unknown'},1,5),null);
  assert.equal(gradeMarket({market_type:'total',market_side:'home',line:6},1,5),null);
  assert.equal(gradeMarket({market_type:'moneyline',market_side:'home'},null,5),null);
});

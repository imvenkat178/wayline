import {parseDeparture} from '../server/domain/agentTools.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretRules} from '../server/domain/workspaceInterpreter.mjs';
import {compileInstruction} from '../server/domain/conversationPlanner.mjs';
const now=Date.parse('2026-09-13T12:00:00Z');
const draft={constraints:{from:'BOS',to:'JFK',mode:'flights',timezone:'America/New_York',departure:'2026-10-20T13:00:00.000Z',travelers:1,bags:0,passengers:[{id:'adult-1',type:'adult',personal:0,cabin:0,checked:0}],preferences:{budgetCents:100000},resolvedAirports:[{id:'airport:LAX',iata:'LAX',name:'Los Angeles',country:'US',kind:'airport',timezone:'America/Los_Angeles'}]}};
test('return and flexible dates cannot replace the outbound departure',()=>{
 const r=interpretRules('Find flights from BOS to JFK on 2026-10-20 at 9 am returning on 2026-10-25',draft,now);
 assert.equal(r.patch.departure,'2026-10-20T13:00:00.000Z');assert.equal(r.patch.returnDate,'2026-10-25');
 const only=interpretRules('Return on 2026-10-25',draft,now);assert.equal(only.patch.departure,undefined);assert.equal(only.patch.returnDate,'2026-10-25');
 const flexible=interpretRules('Also check 2026-10-21 and 2026-10-22',draft,now);
 assert.deepEqual(flexible.patch.flexibleDates,['2026-10-21','2026-10-22']);assert.equal(flexible.patch.departure,undefined);
});
test('multi-city sections retain their own airport time zones and exact dates',()=>{
 const r=interpretRules('Multi-city: BOS to JFK on 2026-10-20 at 9 am; LAX to BOS on 2026-10-25 at 9 am',draft,now);
 assert.equal(r.patch.departure,'2026-10-20T13:00:00.000Z');assert.equal(r.patch.additionalFlights[0].departure,'2026-10-25T16:00:00.000Z');
 assert.equal(r.patch.additionalFlights[0].from,'LAX');assert.equal(r.patch.returnDate,null);
});
test('alternate airports are explicit and unsupported scope requires clarification',()=>{
 assert.deepEqual(interpretRules('Also depart from PVD and JFK',draft,now).patch.originAirports,['PVD','JFK']);
 assert.deepEqual(interpretRules('Also arrive at LGA',draft,now).patch.destinationAirports,['LGA']);
 for(const text of ['Find round-trip flights from BOS to JFK','Check flexible dates','Search nearby airports','Return on 2026-02-30','One-way returning on 2026-10-25','Return on 2026-10-25 at 6 pm'])assert.throws(()=>interpretRules(text,draft,now),{status:400});
});
test('hypothetical return changes remain scenario patches',()=>{
 const r=compileInstruction({op:'branch_scenario',text:'What if I return on 2026-10-25?'},draft);
 assert.equal(r.op,'branch_scenario');assert.equal(r.patch.returnDate,'2026-10-25');assert.equal(draft.constraints.returnDate,undefined);
});

test('clarification replies preserve the original request and reject stale or unrelated answers',()=>{
 const d={...draft,version:3},pending={draftVersion:3,kind:'flight-date',field:'returnDate',pendingOp:'search_options',pendingInput:'Find round-trip flights from BOS to JFK on 2026-10-20 at 9 am'};
 const resumed=compileInstruction({op:'clarify',text:'2026-10-25'},d,{clarification:pending});
 assert.equal(resumed.op,'search_options');assert.equal(resumed.patch.returnDate,'2026-10-25');assert.equal(resumed.patch.departure,'2026-10-20T13:00:00.000Z');
 assert.equal(compileInstruction({op:'clarify',text:'2026-10-25'},{...d,version:4},{clarification:pending}).op,'clarify');
 const airport={draftVersion:3,kind:'missing-endpoint',field:'additionalFlights.0.to',choices:[{value:'JFK',label:'JFK New York'}],pendingCommand:{op:'search_options',patch:{from:'BOS',to:'LAX',additionalFlights:[{from:'LAX',to:'New York',departure:'2026-10-25T16:00:00Z'}]}}};
 const selected=compileInstruction({op:'clarify',text:'JFK'},d,{clarification:airport});assert.equal(selected.patch.additionalFlights[0].to,'JFK');assert.equal(selected.patch.from,'BOS');
 assert.equal(compileInstruction({op:'clarify',text:'JFK and buy it'},d,{clarification:airport}).op,'clarify');
});
test('calendar parsing rejects invalid dates and daylight-saving gaps and ambiguity',()=>{
 const opts={zone:'America/New_York',now:Date.parse('2026-01-01T00:00:00Z')};
 assert.ok(parseDeparture('2026-02-30 at 9 am',opts).error);
 assert.match(parseDeparture('2026-03-08 at 2:30 am',opts).error,/does not exist/);
 assert.match(parseDeparture('2026-11-01 at 1:30 am',opts).error,/occurs twice/);
 assert.equal(parseDeparture('2026-11-01T01:30:00-05:00',opts).departure,'2026-11-01T06:30:00.000Z');
});

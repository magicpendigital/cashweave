import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommandService} from '../backend/command-service.js';
// Test adapter only. Durable, isolated production database is NOT implemented here.
function fixture(){
 const rows=new Map();let tail=Promise.resolve();
 const repository={create:async s=>{if(rows.has(s.id))throw Error('Exists');rows.set(s.id,s);return s;},read:async id=>rows.get(id),transact(id,fn){const p=tail.then(async()=>{const result=await fn(structuredClone(rows.get(id)));rows.set(id,result);return structuredClone(result);});tail=p.catch(()=>{});return p;}};
 const authenticate=async session=>session==='A-token'?{id:'A',emailVerified:true}:session==='B-token'?{id:'B',emailVerified:true}:session==='C-token'?{id:'C',emailVerified:true}:null;
 return {rows,service:createCommandService({authenticate,repository,today:()=> '2026-10-15'})};
}
test('server contract requires authenticated verified identity and denies nonmember reads',async()=>{
 const {service}=fixture();await assert.rejects(()=>service.create('bad',{id:'s',name:'Demo'}),/Unauthenticated/);await service.create('A-token',{id:'s',name:'Demo'});await assert.rejects(()=>service.read('B-token','s'),/Not found/);
 await assert.rejects(()=>service.command('B-token','s',0,{type:'invite',actor:'A',invitee:'C',expires:'2026-10-31'}));
});
test('invitation plaintext only returned on issue, hash stored; intended verified recipient required',async()=>{
 const {service,rows}=fixture();await service.create('A-token',{id:'s',name:'Demo'});
 const issued=await service.command('A-token','s',0,{type:'invite',invitee:'B',expires:'2026-10-31'});assert.equal(issued.invitationToken.length,43);assert.notEqual(rows.get('s').invite.token,issued.invitationToken);assert.equal(issued.state.invite.token,undefined);
 await assert.rejects(()=>service.command('C-token','s',1,{type:'acceptInvite',token:issued.invitationToken,consent:true}));
 await assert.rejects(()=>service.command('B-token','s',1,{type:'acceptInvite',token:'wrong',consent:true}));
 await service.command('B-token','s',1,{type:'acceptInvite',token:issued.invitationToken,consent:true});assert.deepEqual((await service.read('B-token','s')).members,['A','B']);
 await assert.rejects(()=>service.command('B-token','s',2,{type:'acceptInvite',token:issued.invitationToken,consent:true}));
});
test('optimistic revisions reject concurrent stale writes and do not trust actor payload',async()=>{
 const {service}=fixture();await service.create('A-token',{id:'s',name:'Demo'});const invite=await service.command('A-token','s',0,{type:'invite',invitee:'B',expires:'2026-10-31'});await service.command('B-token','s',1,{type:'acceptInvite',token:invite.invitationToken,consent:true});
 const c={type:'addEntry',id:'x',kind:'contribution',amount:100,date:'2026-10-10',actor:'B'};
 const results=await Promise.allSettled([service.command('A-token','s',2,c),service.command('A-token','s',2,{...c,id:'y'})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);const state=await service.read('A-token','s');assert.equal(state.entries.length,1);assert.equal(state.entries[0].actor,'A');
});
test('cross-space read and mutation are denied',async()=>{const {service}=fixture();await service.create('A-token',{id:'s1',name:'One'});await service.create('C-token',{id:'s2',name:'Two'});await assert.rejects(()=>service.read('A-token','s2'));await assert.rejects(()=>service.command('A-token','s2',0,{type:'invite',invitee:'B',expires:'2026-10-31'}));assert.equal((await service.read('C-token','s2')).revision,0);});
test('outsider cannot distinguish wrong revision from missing tenant',async()=>{const {service}=fixture();await service.create('A-token',{id:'s',name:'Demo'});for(const id of ['s','missing'])for(const revision of [0,77])await assert.rejects(()=>service.command('C-token',id,revision,{type:'revokeInvite'}),/^Error: Not found$/);});

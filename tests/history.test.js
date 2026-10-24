import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import definition from '../module.js';import {WorkStore} from '../core/store.js';
const save=(s,collection,data,id)=>{const result=s.transact({operation:'save',collection,data,id,revision:s.read().revision});return id||result.data[collection].at(-1).id;};
const audit=s=>s.db.prepare('SELECT * FROM audit ORDER BY rowid').all();
function rejected(s,action,pattern=/нельзя менять/){const state=s.read(),events=audit(s);assert.throws(action,pattern);assert.deepEqual(s.read(),state);assert.deepEqual(audit(s),events);}
function fixture(s){const c1=save(s,'courses',{name:'SYNTHETIC first',material:'SYNTHETIC material'}),c2=save(s,'courses',{name:'SYNTHETIC second',material:'SYNTHETIC material two'}),q1=save(s,'checks',{course:c1,question:'SYNTHETIC first question',answer:'yes'}),q2=save(s,'checks',{course:c1,question:'SYNTHETIC second question',answer:'no'}),fields={course:c1,learner:'SYNTHETIC original learner',due:'2099-12-31'},a=save(s,'assignments',fields),a2=save(s,'assignments',{...fields,learner:'SYNTHETIC other learner'}),r=save(s,'responses',{assignment:a,check:q1,answer:'yes'});return {c1,c2,q1,q2,a,a2,r,fields};}

test('recorded answer protects assignment learner and course including archived history; deadline remains editable',()=>{
 const s=new WorkStore(definition);try{const f=fixture(s);
 rejected(s,()=>save(s,'assignments',{...f.fields,learner:'SYNTHETIC replacement'},f.a));
 rejected(s,()=>save(s,'assignments',{...f.fields,course:f.c2},f.a),/другому пакету|нельзя менять/);
 s.transact({operation:'archive',collection:'responses',id:f.r,revision:s.read().revision});const historical=s.read().data.responses;
 rejected(s,()=>save(s,'assignments',{...f.fields,course:f.c2},f.a));
 rejected(s,()=>save(s,'assignments',{...f.fields,learner:'SYNTHETIC replacement'},f.a));
 rejected(s,()=>save(s,'checks',{course:f.c1,question:'SYNTHETIC changed',answer:'yes'},f.q1));
 save(s,'assignments',{...f.fields,due:'2099-12-30'},f.a);
 assert.deepEqual(s.read().data.responses,historical);
 s.transact({operation:'archive',collection:'assignments',id:f.a,revision:s.read().revision});
 assert.equal(s.read().data.assignments[0].course,f.c1);assert.equal(s.read().data.assignments[0].learner,f.fields.learner);
 }finally{s.close();}
});

test('recorded response cannot be reassigned to another learner or question; answer correction and explicit retry remain available',()=>{
 const s=new WorkStore(definition);try{const f=fixture(s);
 rejected(s,()=>save(s,'responses',{assignment:f.a2,check:f.q1,answer:'yes'},f.r));
 rejected(s,()=>save(s,'responses',{assignment:f.a,check:f.q2,answer:'yes'},f.r));
 save(s,'responses',{assignment:f.a,check:f.q1,answer:'no'},f.r);assert.match(JSON.stringify(s.read().computed),/0 из 2/);
 s.transact({operation:'archive',collection:'responses',id:f.r,revision:s.read().revision});const historical=s.read().data.responses[0];
 save(s,'responses',{assignment:f.a,check:f.q1,answer:' YES '});
 assert.deepEqual(s.read().data.responses[0],historical);assert.match(JSON.stringify(s.read().computed),/1 из 2/);
 rejected(s,()=>save(s,'responses',{assignment:f.a,check:f.q1,answer:'yes'}),/дубликаты/);
 rejected(s,()=>save(s,'responses',{assignment:f.a,check:f.q1,answer:'yes'},f.r),/Архивная/);
 }finally{s.close();}
});

test('file restart and restore retain historical associations; empty assignments move, legacy archived mismatches remain readable without repair',()=>{
 const dir=mkdtempSync(join(tmpdir(),'branchlearn-history-')),path=join(dir,'workspace.sqlite');let s=new WorkStore(definition,path);const restored=new WorkStore(definition),legacy=new WorkStore(definition);
 try{const f=fixture(s);s.transact({operation:'archive',collection:'responses',id:f.r,revision:s.read().revision});const before=s.read(),events=audit(s),copy=s.export();s.close();s=new WorkStore(definition,path);assert.deepEqual(s.read(),before);assert.deepEqual(audit(s),events);restored.restore(copy);assert.deepEqual(restored.read().data,before.data);
 rejected(restored,()=>save(restored,'assignments',{...f.fields,course:f.c2},f.a));
 save(restored,'assignments',{course:f.c2,learner:'SYNTHETIC revised empty assignment',due:'2099-12-30'},f.a2);
 save(restored,'checks',{course:f.c2,question:'SYNTHETIC revised unanswered question',answer:'no'},f.q2);
 const oldCopy=structuredClone(copy);oldCopy.data.assignments.find(x=>x.id===f.a).course=f.c2;legacy.restore(oldCopy);
 assert.deepEqual(legacy.read().data,oldCopy.data,'Legacy archived mismatch is retained, not silently corrected');
 save(legacy,'courses',{name:'SYNTHETIC unrelated course',material:'SYNTHETIC independent material'});
 rejected(legacy,()=>save(legacy,'assignments',{...f.fields,course:f.c1},f.a));
 assert.equal(legacy.read().data.assignments[0].course,f.c2);
 }finally{s.close();restored.close();legacy.close();rmSync(dir,{recursive:true,force:true});}
});

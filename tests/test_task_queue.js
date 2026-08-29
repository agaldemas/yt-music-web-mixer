'use strict';
const { TaskQueue } = require('../server/task-queue');
let pass = 0;
function ok(v,m){if(!v)throw new Error(m);pass++;}
(async function(){
  const q = new TaskQueue({ concurrency: 1, maxPending: 1 });
  let release; const blocker = new Promise(r => { release = r; });
  const first = q.add(() => blocker.then(() => 1));
  const second = q.add(() => 2);
  let saturated = false;
  try { await q.add(() => 3); } catch (e) { saturated = e.code === 'queue-full'; }
  ok(saturated, 'file non bornée');
  release();
  ok(await first === 1, 'première tâche');
  ok(await second === 2, 'seconde tâche');
  ok(q.stats().pending === 0, 'file non vidée');
  console.log(`TaskQueue: ${pass} assertions passées.`);
})().catch(e=>{console.error(e);process.exit(1)});

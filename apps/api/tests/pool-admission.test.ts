import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabasePool, DatabaseBusyError } from '../src/db/pool.js';
import { runtimePoolPolicy } from '../src/db/runtime-pool-policy.js';
import { connectionOptions } from '../src/db/connection.js';
import { isolatedTestDatabaseUrl } from './local-test-database.js';

test('runtime pool budgets are bounded and never disable timeouts', () => {
  assert.deepEqual(runtimePoolPolicy({}), {maxWaiting:40,options:{max:10,connectionTimeoutMillis:10000,idleTimeoutMillis:10000,statement_timeout:30000,lock_timeout:5000,idle_in_transaction_session_timeout:30000}});
  assert.equal(runtimePoolPolicy({DATABASE_POOL_MAX:'4',DATABASE_POOL_MAX_WAITING:'0'}).maxWaiting,0);
  for (const key of ['DATABASE_POOL_MAX','DATABASE_POOL_MAX_WAITING','DATABASE_POOL_CONNECT_TIMEOUT_MS','DATABASE_STATEMENT_TIMEOUT_MS','DATABASE_LOCK_TIMEOUT_MS','DATABASE_IDLE_TRANSACTION_TIMEOUT_MS']) {
    for (const value of ['-1','1.5','private-secret','99999999999999999999']) {
      assert.throws(() => runtimePoolPolicy({[key]:value}), error => error instanceof Error && error.message.includes(key) && !error.message.includes(value));
    }
  }
  for (const key of ['DATABASE_POOL_MAX','DATABASE_POOL_CONNECT_TIMEOUT_MS','DATABASE_STATEMENT_TIMEOUT_MS','DATABASE_LOCK_TIMEOUT_MS','DATABASE_IDLE_TRANSACTION_TIMEOUT_MS']) assert.throws(() => runtimePoolPolicy({[key]:'0'}));
});

test('URL settings cannot override runtime execution limits', () => {
  for (const key of ['options','statement_timeout','lock_timeout','idle_in_transaction_session_timeout','query_timeout','Statement_Timeout']) {
    assert.throws(() => connectionOptions({DATABASE_URL:`postgresql://demo:secret@localhost/careiq_test?${key}=0`}), error => error instanceof Error && !error.message.includes('secret'));
  }
});

const url=isolatedTestDatabaseUrl();
test('runtime pool caps pending promises and callbacks, then serves later work', {skip:!url}, async()=>{
  const pool=createDatabasePool({connectionString:url!,ssl:false,max:1},undefined,{DATABASE_POOL_MAX_WAITING:'1'});
  try {
    const held=await pool.connect();
    const queued=pool.connect();
    assert.equal(pool.waitingCount,1);
    await assert.rejects(pool.connect(), error=>error instanceof DatabaseBusyError&&error.status===503&&error.code==='DATABASE_BUSY');
    await new Promise<void>((resolve,reject)=>pool.connect((error,client)=>{try{assert.ok(error instanceof DatabaseBusyError);assert.equal(client,undefined);resolve();}catch(failure){reject(failure);}}));
    await new Promise<void>((resolve,reject)=>pool.query('SELECT 1',(error)=>{try{assert.ok(error instanceof DatabaseBusyError);resolve();}catch(failure){reject(failure);}}));
    assert.equal(pool.waitingCount,1);
    held.release();
    (await queued).release();
    assert.equal((await pool.query('SELECT 1 AS healthy')).rows[0].healthy,1);
    const settings=(await pool.query("SELECT current_setting('statement_timeout') AS statement,current_setting('lock_timeout') AS lock,current_setting('idle_in_transaction_session_timeout') AS idle")).rows[0];
    assert.deepEqual(settings,{statement:'30s',lock:'5s',idle:'30s'});
  } finally {await pool.end();}
});

test('same-turn idle-client bursts reserve capacity for promise, callback and query callers', {skip:!url}, async()=>{
  for (const {max,maxWaiting} of [{max:1,maxWaiting:0},{max:1,maxWaiting:2},{max:3,maxWaiting:2}]) {
    const pool=createDatabasePool({connectionString:url!,ssl:false,max},undefined,{DATABASE_POOL_MAX_WAITING:String(maxWaiting)});
    try {
      const warm=await pool.connect();warm.release();
      const attempts=Array.from({length:60},(_,index)=>index%3===0
        ? pool.connect().then(client=>{client.release();return 'accepted';},error=>{assert.ok(error instanceof DatabaseBusyError);return 'busy';})
        : index%3===1 ? new Promise<string>((resolve,reject)=>pool.connect((error,client)=>{if(error){if(!(error instanceof DatabaseBusyError))reject(error);else resolve('busy');}else{client!.release();resolve('accepted');}}))
        : new Promise<string>((resolve,reject)=>pool.query('SELECT 1',error=>{if(error){if(!(error instanceof DatabaseBusyError))reject(error);else resolve('busy');}else resolve('accepted');})));
      assert.ok(pool.waitingCount<=max+maxWaiting);
      const results=await Promise.all(attempts);
      assert.equal(results.filter(value=>value==='accepted').length,max+maxWaiting);
      assert.equal(results.filter(value=>value==='busy').length,60-max-maxWaiting);
      assert.equal((await pool.query('SELECT 1 AS healthy')).rows[0].healthy,1);
    } finally {await pool.end();}
  }
});

test('configured checkout budget survives the real connection-options to pool path', {skip:!url}, async()=>{
  const environment={DATABASE_URL:url!,DATABASE_SSL_MODE:'disable',DATABASE_POOL_CONNECT_TIMEOUT_MS:'500',DATABASE_POOL_MAX_WAITING:'1'};
  const pool=createDatabasePool({...connectionOptions(environment),max:1},undefined,environment);
  try {
    assert.equal(pool.options.connectionTimeoutMillis,500);
    const held=await pool.connect();
    const started=Date.now();
    await assert.rejects(pool.connect(),error=>error instanceof DatabaseBusyError);
    assert.ok(Date.now()-started>=400);
    held.release();
    assert.equal((await pool.query('SELECT 1 AS healthy')).rows[0].healthy,1);
  } finally {await pool.end();}
});

test('bounded checkout expiry is retryable and does not poison the pool', {skip:!url}, async()=>{
  const pool=createDatabasePool({connectionString:url!,ssl:false,max:1,connectionTimeoutMillis:10000},undefined,{DATABASE_POOL_MAX_WAITING:'1'});
  try {
    const held=await pool.connect();
    pool.options.connectionTimeoutMillis=100;
    await assert.rejects(pool.connect(), error=>error instanceof DatabaseBusyError);
    pool.options.connectionTimeoutMillis=10000;
    assert.equal(pool.waitingCount,0);
    held.release();
    assert.equal((await pool.query('SELECT 1 AS healthy')).rows[0].healthy,1);
  } finally {await pool.end();}
});

test('server statement timeout cancels work and rollback clears transaction scope', {skip:!url}, async()=>{
  const pool=createDatabasePool({connectionString:url!,ssl:false,max:1});
  try {
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='100ms'");
      await client.query("SELECT set_config('app.practice_id','00000000-0000-0000-0000-000000000001',true)");
      await assert.rejects(client.query('SELECT pg_sleep(1)'),error=>(error as {code?:string}).code==='57014');
      await client.query('ROLLBACK');
    } finally {client.release();}
    const result=(await pool.query("SELECT NULLIF(current_setting('app.practice_id',true),'') AS scope,1 AS healthy")).rows[0];
    assert.deepEqual(result,{scope:null,healthy:1});
  } finally {await pool.end();}
});


test('idle transaction termination on a checked-out client is handled, evicted and scope is not reused', {skip:!url}, async()=>{
  const failures:Array<{operation:string;code?:string}>=[];
  const pool=createDatabasePool({connectionString:url!,ssl:false,max:1},(operation,error)=>failures.push({operation,code:(error as {code?:string}).code}));
  try {
    const client=await pool.connect();
    let previousPid:number;
    try {
      previousPid=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await client.query('BEGIN');
      await client.query("SET LOCAL idle_in_transaction_session_timeout='100ms'");
      await client.query("SELECT set_config('app.practice_id','00000000-0000-0000-0000-000000000001',true)");
      // No test error listener: the production pool owns checked-out handling.
      await new Promise(resolve=>setTimeout(resolve,300));
      await assert.rejects(client.query('SELECT 1'));
      assert.ok(failures.some(failure=>failure.operation==='PostgreSQL checked-out connection failed'&&failure.code==='25P03'));
    } finally {client.release();}
    const result=(await pool.query("SELECT pg_backend_pid() AS pid,NULLIF(current_setting('app.practice_id',true),'') AS scope,1 AS healthy")).rows[0];
    assert.notEqual(result.pid,previousPid!);
    assert.equal(result.scope,null);
    assert.equal(result.healthy,1);
    assert.equal(failures.length,1,'one sanitized log per failed client, without duplicate idle logs');
  } finally {await pool.end();}
});

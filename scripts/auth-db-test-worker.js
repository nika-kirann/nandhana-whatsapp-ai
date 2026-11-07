// Synthetic loopback-only test worker. Never reads DATABASE_URL or real auth files.
import { Pool } from 'pg';
import { BufferJSON, proto } from '@whiskeysockets/baileys';
import { openPostgresAuth } from '../src/postgres-auth.js';
import assert from 'node:assert/strict';
const port=Number(process.env.NANDHANA_TEST_DB_PORT);
if (!Number.isInteger(port) || port<1024 || port>65535) throw new Error('Invalid synthetic test port');
const [mode,sessionId]=process.argv.slice(2);
const pool=new Pool({host:'127.0.0.1',port,database:'postgres',user:'postgres',ssl:false,max:1,connectionTimeoutMillis:5000,query_timeout:5000});
let store;
try {
  try { store=await openPostgresAuth({allowCreate: ['write','hold'].includes(process.argv[2]),pool,sessionId,key:Buffer.alloc(32,7),codec:BufferJSON,initCreds:()=>({syntheticMarker:'SYNTHETIC-ONLY',counter:1}),fromAppState:value=>proto.Message.AppStateSyncKeyData.fromObject(value)}); }
  catch (error) { if (mode==='contend' && error.message==='AUTH_DATABASE_UNAVAILABLE_OR_SESSION_LOST') { process.stdout.write('exclusive_pass\n'); process.exit(0); } throw error; }
  if(mode==='write') {
    store.state.creds.counter=2; await store.saveCreds();
    await store.state.keys.set({'pre-key':{'synthetic/one':{key:Buffer.from([1,2,3])}},'app-state-sync-key':{'sync-synthetic':{keyData:Buffer.from([4,5,6])}}});
    process.stdout.write('write_pass\n');
  } else if(mode==='read') {
    assert.equal(store.state.creds.counter,2); assert.equal(store.state.creds.syntheticMarker,'SYNTHETIC-ONLY');
    const keys=await store.state.keys.get('pre-key',['synthetic/one']); assert.deepEqual(keys['synthetic/one'].key,Buffer.from([1,2,3]));
    const app=await store.state.keys.get('app-state-sync-key',['sync-synthetic']); assert.ok(app['sync-synthetic'] instanceof proto.Message.AppStateSyncKeyData); assert.deepEqual(Buffer.from(app['sync-synthetic'].keyData),Buffer.from([4,5,6]));
    process.stdout.write('read_pass\n');
  } else if(mode==='hold') {
    process.send?.({state:'locked'}); await new Promise(resolve=>process.once('message',resolve));
    process.stdout.write('hold_released\n');
  } else throw new Error('Unexpected worker mode');
} catch { process.stderr.write('Synthetic DB worker failed\n'); process.exitCode=1; }
finally { await store?.close(); }

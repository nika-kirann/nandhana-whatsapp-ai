import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferJSON } from '@whiskeysockets/baileys';
import { createAuthCipher } from '../src/auth-crypto.js';
import { readAuthConfig, makeAuthPool } from '../src/auth-config.js';
const env={AUTH_STORE:'postgres',SESSION_ID:'synthetic-session',AUTH_ENCRYPTION_KEY:'ab'.repeat(32),DATABASE_URL:'postgresql://synthetic:fixture@db.example/test?sslmode=require'};
test('file auth is default; database URL selects Postgres automatically',()=>{assert.deepEqual(readAuthConfig({}),{store:'file'});assert.equal(readAuthConfig({...env,AUTH_STORE:undefined}).store,'postgres');assert.equal(readAuthConfig({...env,SESSION_ID:''}).sessionId,'');assert.throws(()=>readAuthConfig({DATABASE_URL:'bad'}));});
test('Postgres config requires fixed session, 32-byte key and valid TLS URL',()=>{
 for(const patch of [{AUTH_STORE:'unknown'},{SESSION_ID:'bad/id'},{AUTH_ENCRYPTION_KEY:''},{AUTH_ENCRYPTION_KEY:'x'.repeat(64)},{DATABASE_URL:''},{DATABASE_URL:'https://db.example'},{DATABASE_URL:'postgres://u@db.example/db?sslmode=disable'},{DATABASE_URL:'postgres://u@db.example/db?sslrootcert=/untrusted'}])assert.throws(()=>readAuthConfig({...env,...patch}));
 const config=readAuthConfig(env);assert.equal(config.key.length,32);assert.ok(!config.connectionString.includes('sslmode'));
});
test('single URL supplies runtime and migrations',()=>{assert.equal(new URL(readAuthConfig(env).connectionString).hostname,new URL(env.DATABASE_URL).hostname);assert.equal(new URL(readAuthConfig(env).connectionString).search,'')});
test('AES-GCM roundtrips BufferJSON and encrypts same content nondeterministically',()=>{
 const cipher=createAuthCipher(Buffer.alloc(32,7),'synthetic-session',BufferJSON),value={secret:Buffer.from([1,2,3]),marker:'SYNTHETIC-ONLY'};
 const a=cipher.encrypt(value,'key:pre-key','one'),b=cipher.encrypt(value,'key:pre-key','one');
 assert.notEqual(a.data,b.data);assert.deepEqual(cipher.decrypt(a,'key:pre-key','one'),value);assert.ok(!JSON.stringify(a).includes('SYNTHETIC-ONLY'));
});
test('AAD binds session, category, key ID and version; tampering/wrong key fail closed',()=>{
 const cipher=createAuthCipher(Buffer.alloc(32,7),'s-one',BufferJSON),envelope=cipher.encrypt({marker:'synthetic'},'key:pre-key','one');
 for(const [c,kind,id,e] of [[cipher,'key:other','one',envelope],[cipher,'key:pre-key','two',envelope],[createAuthCipher(Buffer.alloc(32,7),'s-two',BufferJSON),'key:pre-key','one',envelope],[createAuthCipher(Buffer.alloc(32,8),'s-one',BufferJSON),'key:pre-key','one',envelope],[cipher,'key:pre-key','one',{...envelope,v:2}],[cipher,'key:pre-key','one',{...envelope,tag:Buffer.alloc(16).toString('base64')}]] )assert.throws(()=>c.decrypt(e,kind,id),/AUTH_DECRYPT_FAILED/);
});

test('effective pg TLS settings verify certificates even with sslmode URL',async()=>{
 const { Client }=await import('pg');const pool=await makeAuthPool(readAuthConfig(env));
 try{const client=new Client(pool.options);assert.equal(client.connectionParameters.ssl.rejectUnauthorized,true);assert.equal(pool.options.max,2);assert.equal(pool.options.enableChannelBinding,true);assert.equal(pool.options.query_timeout,5000)}finally{await pool.end()}
});

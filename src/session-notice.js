import { openAuthStore } from './auth-store.js';
import { hasLinkedIdentity, pairSocketOptions } from './pairing.js';
// Auth-only reconnection; no message/history listeners. A durable reservation prevents retries.
export async function runSelfNotice({storage,sessionId,makeSocket,normalizeJid,logger,timeoutMs=30000,signal}) {
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)||!hasLinkedIdentity(storage.state.creds)) return 'failed';
  if(signal?.aborted)return 'failed';
  if(!storage.claimNotice) return 'unavailable';
  const claim=await storage.claimNotice();
  if(!claim.claimed)return claim.status==='sent'?'sent':'already_attempted';
  let socket,ended=false,started=false,attempted=false,saves=Promise.resolve(),resolveDone;
  const done=new Promise(resolve=>{resolveDone=resolve;});
  const timer=setTimeout(()=>void finish(attempted?'unknown':'failed'),timeoutMs);
  async function finish(outcome){
    if(ended)return;ended=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
    try{socket?.end(undefined);}catch{}
    try{await saves;await storage.finishNotice(outcome);}catch{outcome='unknown';}
    resolveDone(outcome);
  }
  const abort=()=>void finish(attempted?'unknown':'failed');
  signal?.addEventListener('abort',abort,{once:true});
  try{
    if(signal?.aborted)throw new Error();
    storage.assertActive();socket=makeSocket(pairSocketOptions(storage.state,logger));
    socket.ev.on('creds.update',()=>{if(!ended){saves=saves.then(storage.saveCreds);saves.catch(()=>void finish(attempted?'unknown':'failed'));}});
    socket.ev.on('connection.update',update=>{
      if(ended)return;
      if(update.qr||update.connection==='close'){void finish(attempted?'unknown':'failed');return;}
      if(update.connection!=='open'||started)return;started=true;
      void(async()=>{
        const own=normalizeJid(storage.state.creds.me.id),connected=normalizeJid(socket.user?.id || '');
        if(!/^[0-9]+@(s\.whatsapp\.net|lid)$/.test(own)||own!==connected)throw new Error();
        await saves;await storage.guard();storage.assertActive();if(ended)return;
        attempted=true;
        await socket.sendMessage(own,{text:'Nandhana session ID: '+sessionId});
        await finish('sent');
      })().catch(()=>void finish(attempted?'unknown':'failed'));
    });
  }catch{void finish('failed');}
  return done;
}
export async function sendSessionNotice({env=process.env,signal}={}){
  const [{default:makeSocket,jidNormalizedUser},{default:pino}]=await Promise.all([import('@whiskeysockets/baileys'),import('pino')]);
  const lost=new AbortController();
  const storage=await openAuthStore({env,onLost:()=>lost.abort()});
  try{return await runSelfNotice({storage,sessionId:env.SESSION_ID,makeSocket,normalizeJid:jidNormalizedUser,logger:pino({level:'silent'}),signal:signal?AbortSignal.any([signal,lost.signal]):lost.signal});}
  finally{await storage.close();}
}

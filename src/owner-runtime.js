import { randomUUID } from 'node:crypto';
import { createWebPairing, liveWebPairing } from './web-pairing.js';
import { main } from './main.js';
import { sendSessionNotice } from './session-notice.js';
export function createOwnerRuntime({env=process.env,runPair=liveWebPairing,startBot=main,sendNotice=sendSessionNotice,makeId=randomUUID}={}) {
  let selected=env.SESSION_ID || '', verified='', downloader='stopped', notice='not_requested', busy=false, closing=false, bot, pendingNotice, pendingActivation, noticeAbort, activationError=false;
  const available=()=>!closing&&!busy&&downloader==='stopped';
  const pairing=createWebPairing({run:async options=>{
    const creating=!selected, candidate=selected || makeId();
    const handle=await runPair({...options,env:{...env,SESSION_ID:candidate},allowCreate:creating,newSession:creating});
    return {...handle,done:handle.done.then(outcome=>{if(outcome==='paired'){selected=candidate;verified=candidate;}return outcome;})};
  }});
  return {
    snapshot(){return {...pairing.snapshot(),pairingAllowed:available(),sessionId:verified || undefined,hasSelectedSession:!!selected,downloader,notice,busy,activationError};},
    remainingMs:()=>pairing.remainingMs(),qr:()=>pairing.qr(),code:()=>pairing.code(),
    start(mode,phone){if(!available())return false;return pairing.start(mode,phone);},stop:()=>pairing.stop(),
    async activate(){
      if(!available()||pairing.snapshot().active||!selected)return false;
      busy=true;activationError=false;downloader='starting';
      pendingActivation=(async()=>{try {
        const handle=await startBot({env:{...env,SESSION_ID:selected},ownerApproved:true,onConnection:()=>{if(!closing)downloader='running';},onStopped:()=>{downloader='stopped';bot=undefined;}});
        if(closing||downloader==='stopped') await handle?.stop();else bot=handle;
      } catch {downloader='stopped';activationError=true;} finally {busy=false;}})();
      try { await pendingActivation; } finally {pendingActivation=undefined;}
      return true;
    },
    async deactivate(){if(busy)return false;busy=true;try{await bot?.stop();bot=undefined;downloader='stopped';}finally{busy=false;}return true;},
    async notify(){
      if(!available()||pairing.snapshot().active||!verified||notice!=='not_requested')return false;
      busy=true;notice='sending';
      noticeAbort=new AbortController();
      try {pendingNotice=sendNotice({env:{...env,SESSION_ID:verified},signal:noticeAbort.signal});const result=await pendingNotice;notice=['sent','failed','unknown','already_attempted','unavailable'].includes(result)?result:'unknown';}
      catch {notice='failed';} finally {busy=false;pendingNotice=undefined;noticeAbort=undefined;}
      return true;
    },
    async close(){closing=true;noticeAbort?.abort();await pendingActivation?.catch(()=>{});await pendingNotice?.catch(()=>{});await pairing.close();await bot?.stop();}
  };
}

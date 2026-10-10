import {mkdirSync,openSync,writeFileSync,closeSync,readFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

export function integerSetting(value,name,min,max){
  const n=Number(value);
  if(value===''||!Number.isSafeInteger(n)||n<min||n>max)throw Error(`${name}须为 ${min}–${max} 的整数`);
  return n;
}

// One local executor owns a data directory. Read-only database tools are unaffected.
export function runtimeLock(dir){
  mkdirSync(dir,{recursive:true,mode:0o700});
  const file=join(dir,'.runtime.lock'),record=JSON.stringify({pid:process.pid,token:randomUUID()});
  for(let i=0;i<3;i++){
    let fd;
    try{fd=openSync(file,'wx',0o600);writeFileSync(fd,record);closeSync(fd);return ()=>{try{if(readFileSync(file,'utf8')===record)unlinkSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}};}
    catch(e){if(fd!==undefined){closeSync(fd);try{unlinkSync(file);}catch{}}if(e.code!=='EEXIST')throw e;}
    let old,owner;
    try{old=readFileSync(file,'utf8');owner=JSON.parse(old);}catch(e){if(e.code==='ENOENT')continue;throw Error('数据目录运行锁格式有误，请检查 .runtime.lock');}
    if(!Number.isSafeInteger(owner.pid)||owner.pid<1||typeof owner.token!=='string')throw Error('数据目录运行锁格式有误，请检查 .runtime.lock');
    let alive=true;
    try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;else if(e.code!=='EPERM')throw e;}
    if(alive)throw Error('该数据目录已有服务在运行，请使用独立数据目录或先停止现有服务');
    try{if(readFileSync(file,'utf8')===old)unlinkSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  throw Error('数据目录运行锁竞争，请稍后重新启动');
}

export function scheduler({concurrency,claim,execute,onError}){
  const active=new Map();let paused=true,timer=null;
  const kick=()=>{if(paused||timer)return;timer=setImmediate(()=>{timer=null;pump();});};
  function pump(){
    while(!paused&&active.size<concurrency){
      const job=claim();if(!job)break;
      const task=Promise.resolve().then(()=>execute(job)).catch(e=>onError(job,e)).finally(()=>{active.delete(job);kick();});
      active.set(job,task);
    }
  }
  return {
    start(){paused=false;kick();},kick,
    pause(){paused=true;if(timer){clearImmediate(timer);timer=null;}},
    async drain(){await Promise.allSettled([...active.values()]);},
    state(){return {active:active.size,concurrency,paused};}
  };
}

import {hash} from './security.mjs';
export const requestSchema=`
  CREATE TABLE IF NOT EXISTS request_keys (
    owner_id TEXT NOT NULL REFERENCES users(id),scope TEXT NOT NULL,key_hash TEXT NOT NULL,
    request_hash TEXT NOT NULL,job_id TEXT NOT NULL REFERENCES jobs(id),created_at TEXT NOT NULL,
    PRIMARY KEY(owner_id,scope,key_hash)
  );
  CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(status,created_at);
`;
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
export function idempotency(d,{key,owner,scope,body},fail){
  if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'请求须为 JSON 对象');
  if(key===undefined)return {replay:null,record(){}};
  if(typeof key!=='string'||!/^[-a-zA-Z0-9._:]{1,128}$/.test(key))fail(400,'Idempotency-Key 须为 1–128 位字母、数字、点、下划线、冒号或连字符');
  const keyHash=hash(key),requestHash=hash(JSON.stringify(canonical(body)));
  const old=d.one('SELECT * FROM request_keys WHERE owner_id=? AND scope=? AND key_hash=?',owner,scope,keyHash);
  if(old){if(old.request_hash!==requestHash)fail(409,'同一 Idempotency-Key 已用于不同请求，请使用新键');return {replay:d.one('SELECT * FROM jobs WHERE id=?',old.job_id),record(){}};}
  return {replay:null,record(job){d.run('INSERT INTO request_keys(owner_id,scope,key_hash,request_hash,job_id,created_at) VALUES(?,?,?,?,?,?)',owner,scope,keyHash,requestHash,job,new Date().toISOString());}};
}

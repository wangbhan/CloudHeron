import {randomBytes, scryptSync, timingSafeEqual, createHash, createCipheriv, createDecipheriv} from 'node:crypto';
export const id = prefix => prefix+'_'+randomBytes(12).toString('hex');
export const token = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');
export function password(value) {
  if(typeof value!=='string'||value.length<10||value.length>200) throw new Error('密码须为 10–200 位');
  const salt=randomBytes(16).toString('hex');
  return salt+':'+scryptSync(value,salt,64).toString('hex');
}
export function verify(value, encoded) {
  if(typeof value!=='string'||value.length>200) return false;
  const [salt,digest]=encoded.split(':'); const a=scryptSync(value,salt,64), b=Buffer.from(digest,'hex');
  return a.length===b.length&&timingSafeEqual(a,b);
}
export function vault(key) {
  return {
    encrypt(value) {if(!value)return '';const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),out=Buffer.concat([c.update(value,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),out]).toString('base64');},
    decrypt(value) {if(!value)return '';const b=Buffer.from(value,'base64'),d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8');}
  };
}
export const roles=['admin','editor','viewer'];
export function permission(user, resource, edit=false) {
  if(!user?.active || (edit&&user.role==='viewer'))return false;
  if(user.role==='admin'||resource.owner_id===user.id)return true;
  const level=JSON.parse(resource.acl||'{}')[user.id];
  return resource.visibility==='team'||(edit?level==='edit':['read','edit'].includes(level));
}

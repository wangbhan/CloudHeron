import base64, binascii, hashlib, hmac, secrets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import HTTPException

def fail(status, message): raise HTTPException(status, message)
def now_ms():
    import time
    return int(time.time()*1000)
def uid(prefix): return prefix+'_'+secrets.token_hex(12)
def token(): return secrets.token_urlsafe(32)
def digest(value): return hashlib.sha256(value.encode()).hexdigest()
def text(value,label='内容',maximum=200):
    if not isinstance(value,str) or not value.strip() or len(value)>maximum: fail(400,f'{label}须为 1–{maximum} 个字符')
    return value.strip()
def password(value):
    if not isinstance(value,str) or not 10<=len(value)<=200: fail(400,'密码须为 10–200 位')
    salt=secrets.token_hex(16)
    return salt+':'+hashlib.scrypt(value.encode(),salt=salt.encode(),n=16384,r=8,p=1,dklen=64,maxmem=64*1024*1024).hex()
def verify(value,encoded):
    if not isinstance(value,str) or len(value)>200: return False
    try:
        salt,expected=encoded.split(':')
        if len(salt)!=32 or len(expected)!=128: return False
        actual=hashlib.scrypt(value.encode(),salt=salt.encode(),n=16384,r=8,p=1,dklen=64,maxmem=64*1024*1024).hex()
        return hmac.compare_digest(actual,expected)
    except (ValueError,TypeError): return False
class Vault:
    def __init__(self,key):
        message = 'VAULT_KEY_B64 须为 32 字节密钥的 Base64 编码'
        try:
            self.key = base64.b64decode(key, validate=True)
        except (binascii.Error, ValueError):
            raise ValueError(message) from None
        if len(self.key) != 32:
            raise ValueError(message)
    def encrypt(self,value):
        if not value: return ''
        iv=secrets.token_bytes(12);out=AESGCM(self.key).encrypt(iv,value.encode(),None)
        return base64.b64encode(iv+out[-16:]+out[:-16]).decode()
    def decrypt(self,value):
        if not value: return ''
        data=base64.b64decode(value,validate=True)
        return AESGCM(self.key).decrypt(data[:12],data[28:]+data[12:28],None).decode()
def permission(user,resource,edit=False):
    if not user or not user['active'] or not resource or (edit and user['role']=='viewer'): return False
    if user['role']=='admin' or resource['owner_id']==user['id']: return True
    level=resource.get('acl',{}).get(user['id'])
    return resource['visibility']=='team' or (level=='edit' if edit else level in ('edit','read'))
def clean_user(u): return {k:u[k] for k in ('id','name','email','role','active')}

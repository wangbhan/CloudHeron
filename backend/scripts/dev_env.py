from pathlib import Path
import base64,secrets,os
root=Path(__file__).resolve().parents[1];target=root/'.env'
if target.exists(): raise SystemExit('已有 .env，保留现有配置')
pg=secrets.token_urlsafe(24);access='dev-'+secrets.token_hex(8);secret=secrets.token_urlsafe(32)
value=f'''DATABASE_URL=postgresql://cloudheron:{pg}@127.0.0.1:55432/cloudheron
POSTGRES_PASSWORD={pg}
VAULT_KEY_B64={base64.b64encode(secrets.token_bytes(32)).decode()}
S3_ENDPOINT_URL=http://127.0.0.1:59000
S3_BUCKET=cloudheron-dev
S3_REGION=us-east-1
S3_ACCESS_KEY={access}
S3_SECRET_KEY={secret}
S3_ADDRESSING_STYLE=path
S3_ALLOW_HTTP=true
S3_CREATE_BUCKET=true
S3_DISABLE_EXPECT=true
'''
fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f: f.write(value)
print('本机 .env 已生成，凭据未显示、未提交 Git。')

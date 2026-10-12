"""Export the frontend contract without connecting to database or bucket."""
import base64,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from cloudheron.main import create_app
from cloudheron.config import Settings
settings=Settings(_env_file=None,database_url='postgresql://contract:placeholder@localhost/contract',vault_key_b64=base64.b64encode(bytes(32)).decode(),s3_bucket='contract-placeholder')
spec=create_app(settings).openapi()
(ROOT/'openapi.json').write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
print(f"OpenAPI exported: {len(spec['paths'])} paths, {sum(m in ('get','post','put','patch','delete') for p in spec['paths'].values() for m in p)} operations")

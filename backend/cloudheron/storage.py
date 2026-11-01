import re
from urllib.parse import urlsplit
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from fastapi.responses import StreamingResponse
from .security import fail

def sniff(data,mime=None):
    found=None
    if data[:8]==b'\x89PNG\r\n\x1a\n': found='image/png'
    elif data[:3]==b'\xff\xd8\xff': found='image/jpeg'
    elif data[:4]==b'RIFF' and data[8:12]==b'WEBP': found='image/webp'
    elif data[:6] in (b'GIF87a',b'GIF89a'): found='image/gif'
    elif data[4:8]==b'ftyp': found='video/mp4'
    elif data[:4]==b'\x1aE\xdf\xa3': found='video/webm'
    if not found or (mime and found!=mime): fail(400,'文件格式与内容不符')
    if not 10<=len(data)<=100*1024*1024: fail(400,'媒体大小须为 10 字节–100 MB')
    return found
class Storage:
    def __init__(self,settings):
        if settings.s3_endpoint_url and not settings.s3_endpoint_url.startswith('https://') and not settings.s3_allow_http: raise ValueError('云桶 endpoint 须为 HTTPS，开发 HTTP 需要显式允许')
        self.bucket=settings.s3_bucket
        local=urlsplit(settings.s3_endpoint_url or '').hostname in ('localhost','127.0.0.1','::1')
        self.client=boto3.client('s3',endpoint_url=settings.s3_endpoint_url,region_name=settings.s3_region,aws_access_key_id=settings.s3_access_key,aws_secret_access_key=settings.s3_secret_key,config=Config(**({'proxies':{}} if local else {}),request_checksum_calculation='when_required',response_checksum_validation='when_required',signature_version='s3v4',s3={'addressing_style':settings.s3_addressing_style},connect_timeout=5,read_timeout=60,retries={'max_attempts':2}))
        if settings.s3_create_bucket:
            try: self.client.head_bucket(Bucket=self.bucket)
            except ClientError as e:
                if str(e.response['Error']['Code']) not in ('404','NoSuchBucket','NotFound'): raise
                args={'Bucket':self.bucket}
                if settings.s3_region!='us-east-1': args['CreateBucketConfiguration']={'LocationConstraint':settings.s3_region}
                self.client.create_bucket(**args)
        if settings.s3_disable_expect:
            # Compatibility with development S3 servers that do not support 100-continue.
            def without_expect(request,**kwargs):
                if 'Expect' in request.headers: del request.headers['Expect']
            self.client.meta.events.register('before-sign.s3.PutObject',without_expect)
    def check(self): self.client.head_bucket(Bucket=self.bucket)
    def put(self,key,data,mime): self.client.put_object(Bucket=self.bucket,Key=key,Body=data,ContentType=mime)
    def delete(self,key): self.client.delete_object(Bucket=self.bucket,Key=key)
    def read(self,key):
        body=self.client.get_object(Bucket=self.bucket,Key=key)['Body']
        try: return body.read(100*1024*1024+1)
        finally: body.close()
    def url(self,key): return self.client.generate_presigned_url('get_object',Params={'Bucket':self.bucket,'Key':key},ExpiresIn=300)
    def response(self,key,mime,range_header=None):
        args={'Bucket':self.bucket,'Key':key}
        if range_header:
            if not re.fullmatch(r'bytes=\d+-\d*',range_header): fail(416,'请求范围有误')
            args['Range']=range_header
        try: out=self.client.get_object(**args)
        except ClientError as e:
            if e.response['Error']['Code']=='InvalidRange': fail(416,'请求范围超出文件')
            fail(502,'对象存储读取失败，请检查桶配置')
        body=out['Body']
        def chunks():
            try:
                while chunk:=body.read(64*1024): yield chunk
            finally: body.close()
        headers={'Content-Length':str(out['ContentLength']),'Accept-Ranges':'bytes','Cache-Control':'private, no-store','Content-Disposition':'inline'}
        if 'ContentRange' in out: headers['Content-Range']=out['ContentRange']
        return StreamingResponse(chunks(),status_code=206 if range_header else 200,media_type=mime,headers=headers)

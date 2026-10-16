"""Manage the local FastAPI service without binding it to a terminal session."""
import argparse,fcntl,json,os,signal,socket,subprocess,sys,time
from pathlib import Path
from urllib.parse import urlsplit
import httpx

BACKEND=Path(__file__).resolve().parents[1]
ROOT=BACKEND.parent
SCRIPT=Path(__file__).resolve()
sys.path.insert(0,str(BACKEND))
os.chdir(BACKEND)
RUN=Path(os.getenv('CLOUDHERON_RUN_DIR',str(ROOT/'.work/cloudheron-runtime'))).resolve()
STATE=RUN/'service.json'
PORT=int(os.getenv('PORT','8800'))
HOST=os.getenv('HOST','127.0.0.1')
if HOST not in ('127.0.0.1','localhost'):raise SystemExit('后台开发管理仅绑定本机；外部部署请使用scripts/start.sh与正式进程管理器')
if not 1<=PORT<=65535:raise SystemExit('PORT须为1～65535')

def read_state():
    try:return json.loads(STATE.read_text())
    except (FileNotFoundError,ValueError):return {}

def owned(state):
    pid=state.get('pid')
    if type(pid)!=int or pid<=1:return False
    command=subprocess.run(['ps','-p',str(pid),'-o','args='],capture_output=True,text=True).stdout
    # Path may contain spaces. Compare the exact script path and argument suffix.
    return command.strip()==sys.executable+' '+str(SCRIPT)+' _run'

def listening(host,port):
    try:
        with socket.create_connection((host,port),timeout=.3):return True
    except OSError:return False

def status():
    state=read_state()
    if not owned(state):return {'status':'stopped','port':PORT,'url':f'http://127.0.0.1:{PORT}','log':str(RUN/'service.log')}
    out={**state,'status':'starting','log':str(RUN/'service.log')}
    if state.get('stopping'):out['status']='stopping';return out
    try:
        r=httpx.get(f"http://127.0.0.1:{state['port']}/api/ready",timeout=1,trust_env=False)
        data=r.json()
        if r.status_code==200 and data.get('status')=='ready' and data.get('database')=='postgresql':out.update(status='ready',version=data['version'])
        elif state.get('stopping'):out['status']='stopping'
        else:out['status']='unready'
    except (httpx.HTTPError,ValueError):
        if state.get('stopping'):out['status']='stopping'
    return out

def write_state(value):
    temporary=STATE.with_suffix('.tmp');temporary.write_text(json.dumps(value,ensure_ascii=False));temporary.chmod(0o600);temporary.replace(STATE)

def supervise():
    from cloudheron.config import Settings
    s=Settings();RUN.mkdir(parents=True,exist_ok=True)
    lock=open(RUN/'runtime.lock','a')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:raise SystemExit('后台服务已在运行')
    state={'pid':os.getpid(),'port':PORT,'url':f'http://127.0.0.1:{PORT}','started_at':time.time(),'restarts':0}
    write_state(state);stopping=False;api=None;storage=None;exit_code=0
    def stop(signum,frame):
        nonlocal stopping
        stopping=True;state['stopping']=True;write_state(state)
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    def spawn(args):return subprocess.Popen(args,stdin=subprocess.DEVNULL,close_fds=True)
    try:
        if listening('127.0.0.1',PORT):raise RuntimeError('主端口已占用，未终止其它进程')
        if s.dev_storage=='moto':
            if s.s3_endpoint_url!='http://127.0.0.1:59000' or not s.s3_allow_http:raise RuntimeError('开发Moto仅允许显式的本机59000 HTTP配置')
            db=urlsplit(s.database_url)
            if db.hostname=='127.0.0.1' and db.port==55432 and db.path=='/cloudheron':
                subprocess.run([sys.executable,str(BACKEND/'scripts/start_local_pg.py')],check=True)
            if not listening('127.0.0.1',59000):
                print('开发S3模拟器启动；对象不持久，正式环境须使用云桶。',flush=True)
                storage=spawn([sys.executable,'-m','moto.server','-H','127.0.0.1','-p','59000'])
                deadline=time.monotonic()+10
                while not stopping and not listening('127.0.0.1',59000):
                    if storage.poll() is not None or time.monotonic()>deadline:raise RuntimeError('开发S3启动失败，请查看service.log')
                    time.sleep(.1)
        api_args=[sys.executable,'-m','uvicorn','cloudheron.main:create_app','--factory','--host','127.0.0.1','--port',str(PORT),'--workers','1']
        if not stopping:
            api=spawn(api_args);state['api_pid']=api.pid;state['storage_pid']=storage.pid if storage else None;write_state(state)
        delay=1
        while not stopping:
            if storage is not None and storage.poll() is not None:
                print('开发S3进程退出，准备恢复；原模拟对象已丢失。',flush=True)
                storage=spawn([sys.executable,'-m','moto.server','-H','127.0.0.1','-p','59000']);state['storage_pid']=storage.pid;state['restarts']+=1;write_state(state)
            if api is not None and api.poll() is not None:
                print('API进程退出，稍后恢复。',flush=True)
                if stopping:break
                until=time.monotonic()+delay
                while not stopping and time.monotonic()<until:time.sleep(.1)
                if stopping:break
                # A port taken while our process was down belongs to someone else.
                if listening('127.0.0.1',PORT):raise RuntimeError('恢复时主端口被其它服务占用，已停止后台管理')
                api=spawn(api_args);state['api_pid']=api.pid;state['restarts']+=1;write_state(state);delay=min(delay*2,15)
            time.sleep(.25)
    except Exception as e:
        # Do not include connection URLs or environment values in logs.
        print('后台启动/监督失败：'+type(e).__name__+'；检查依赖配置与前面的日志。',flush=True);exit_code=1
    finally:
        if api is not None and api.poll() is None:
            api.terminate();api.wait() # Wait for in-flight generation; no forced kill.
        if storage is not None and storage.poll() is None:storage.terminate();storage.wait()
        if read_state().get('pid')==os.getpid():STATE.unlink(missing_ok=True)
        fcntl.flock(lock,fcntl.LOCK_UN);lock.close()
    return exit_code

def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['start','status','stop','_run']);parser.add_argument('--json',action='store_true');args=parser.parse_args()
    if args.action=='_run':return supervise()
    RUN.mkdir(parents=True,exist_ok=True)
    with open(RUN/'control.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if args.action=='status':result=status();code=0 if result['status']=='ready' else 1
        elif args.action=='stop':
            state=read_state()
            if owned(state):os.kill(state['pid'],signal.SIGTERM)
            until=time.monotonic()+10
            while owned(read_state()) and time.monotonic()<until:time.sleep(.1)
            result=status();code=0 if result['status'] in ('stopped','stopping') else 1
        else:
            state=read_state()
            if owned(state):result=status();code=0 if result['status']=='ready' else 1
            elif listening('127.0.0.1',PORT):result={'status':'port_in_use','port':PORT,'error':'端口被其它服务占用，未修改或停止它'};code=1
            else:
                log=open(RUN/'service.log','a');os.chmod(RUN/'service.log',0o600)
                child=subprocess.Popen([sys.executable,str(SCRIPT),'_run'],stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True,close_fds=True);log.close()
                until=time.monotonic()+25;result=status()
                while time.monotonic()<until:
                    result=status()
                    if result['status']=='ready':break
                    if child.poll() is not None:break
                    time.sleep(.2)
                code=0 if result['status']=='ready' else 1
                if code:result.update(error='服务未就绪，请查看日志；可用status检查或stop正常停止')
    print(json.dumps(result,ensure_ascii=False,indent=None if args.json else 2))
    return code

if __name__=='__main__':raise SystemExit(main())

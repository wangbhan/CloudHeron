"""Manage the local FastAPI service without binding it to a terminal session."""
import argparse,fcntl,json,os,signal,socket,subprocess,sys,time
from pathlib import Path
from typing import NamedTuple
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

class Process(NamedTuple):
    pid: int
    parent: int
    started: str
    command: str


def process(pid):
    if type(pid) is not int or pid <= 1:
        return None
    result = subprocess.run(
        ['ps', '-ww', '-p', str(pid), '-o', 'ppid=', '-o', 'stat=', '-o', 'lstart=', '-o', 'command='],
        capture_output=True, text=True,
    )
    fields = result.stdout.strip().split(maxsplit=7)
    if result.returncode or len(fields) != 8 or fields[1].startswith('Z'):
        return None
    return Process(pid, int(fields[0]), ' '.join(fields[2:7]), fields[7])


def api_command(port):
    return ['-m', 'uvicorn', 'cloudheron.main:create_app', '--factory',
            '--host', '127.0.0.1', '--port', str(port), '--workers', '1']


STORAGE_COMMAND = ['-m', 'moto.server', '-H', '127.0.0.1', '-p', '59000']


def matches_command(proc, args):
    if proc:
        interpreter, match, suffix = proc.command.rpartition(' ' + ' '.join(args))
        if match and not suffix:
            return interpreter
    return None


def supervisor(state):
    proc = process(state.get('pid'))
    if matches_command(proc, [str(SCRIPT), '_run']):
        if 'supervisor_started' not in state or state['supervisor_started'] == proc.started:
            return proc
    return None


def managed_child(state, key, args):
    proc = process(state.get(key + '_pid'))
    interpreter = matches_command(proc, args)
    if not interpreter:
        return None
    identity = key + '_started'
    if identity in state:
        return proc if state[identity] == proc.started else None
    # An older runtime record has no process start identity. Only adopt
    # reparented children launched with a Python executable in this checkout.
    if proc.parent == 1 and Path(interpreter).is_relative_to(ROOT):
        return proc
    return None


def managed_children(state):
    return (
        managed_child(state, 'api', api_command(state.get('port', PORT))),
        managed_child(state, 'storage', STORAGE_COMMAND),
    )


def active(proc):
    current = process(proc.pid)
    return current is not None and current.started == proc.started and current.command == proc.command


def request_stop(proc):
    if proc and active(proc):
        try:
            os.kill(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


def wait_for_exit(proc, deadline):
    if proc:
        while time.monotonic() < deadline and active(proc):
            time.sleep(.1)
        return not active(proc)
    return True


def listening(host,port):
    try:
        with socket.create_connection((host,port),timeout=.3):return True
    except OSError:return False

def status():
    state = read_state()
    port = state.get('port', PORT)
    if not supervisor(state):
        api, storage = managed_children(state)
        out = {'status':'stopped', 'port':port, 'url':f'http://127.0.0.1:{port}', 'log':str(RUN/'service.log')}
        if api or storage:
            out.update(status='stopping' if state.get('stopping') else 'orphaned',
                       api_pid=api.pid if api else None, storage_pid=storage.pid if storage else None)
        elif listening('127.0.0.1', port):
            out.update(status='port_in_use', error='端口仍有服务监听，当前运行目录未识别到对应的云鹭进程')
        return out
    out = {**state, 'status':'starting', 'log':str(RUN/'service.log')}
    if state.get('stopping'):
        out['status'] = 'stopping'
        return out
    try:
        r = httpx.get(f"http://127.0.0.1:{port}/api/ready", timeout=1, trust_env=False)
        data = r.json()
        if r.status_code == 200 and data.get('status') == 'ready' and data.get('database') == 'postgresql':
            out.update(status='ready', version=data['version'])
        else:
            out['status'] = 'unready'
    except (httpx.HTTPError, ValueError):
        pass
    return out


def write_state(value):
    temporary=STATE.with_suffix('.tmp');temporary.write_text(json.dumps(value,ensure_ascii=False));temporary.chmod(0o600);temporary.replace(STATE)

def supervise():
    from cloudheron.config import Settings
    s=Settings();RUN.mkdir(parents=True,exist_ok=True)
    lock=open(RUN/'runtime.lock','a')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:raise SystemExit('后台服务已在运行')
    state={'pid':os.getpid(),'port':PORT,'url':f'http://127.0.0.1:{PORT}','started_at':time.time(),'restarts':0,'storage_pid':None}
    owner = process(os.getpid())
    if owner: state['supervisor_started'] = owner.started
    write_state(state);stopping=False;api=None;storage=None;exit_code=0
    def stop(signum,frame):
        nonlocal stopping
        stopping=True
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    def spawn(key, args):
        child = subprocess.Popen([sys.executable, *args],stdin=subprocess.DEVNULL,close_fds=True)
        proc = process(child.pid)
        state[key + '_pid'] = child.pid
        state[key + '_started'] = proc.started if proc else None
        write_state(state)
        return child
    try:
        if listening('127.0.0.1',PORT):raise RuntimeError('主端口已占用，未终止其它进程')
        if s.dev_storage=='moto':
            if s.s3_endpoint_url!='http://127.0.0.1:59000' or not s.s3_allow_http:raise RuntimeError('开发Moto仅允许显式的本机59000 HTTP配置')
            db=urlsplit(s.database_url)
            if db.hostname=='127.0.0.1' and db.port==55432 and db.path=='/cloudheron':
                subprocess.run([sys.executable,str(BACKEND/'scripts/start_local_pg.py')],check=True)
            if not listening('127.0.0.1',59000):
                print('开发S3模拟器启动；对象不持久，正式环境须使用云桶。',flush=True)
                storage=spawn('storage', STORAGE_COMMAND)
                deadline=time.monotonic()+10
                while not stopping and not listening('127.0.0.1',59000):
                    if storage.poll() is not None or time.monotonic()>deadline:raise RuntimeError('开发S3启动失败，请查看service.log')
                    time.sleep(.1)
        if not stopping:
            api = spawn('api', api_command(PORT))
        delay=1
        while not stopping:
            if storage is not None and storage.poll() is not None:
                print('开发S3进程退出，准备恢复；原模拟对象已丢失。',flush=True)
                storage=spawn('storage', STORAGE_COMMAND);state['restarts']+=1;write_state(state)
            if api is not None and api.poll() is not None:
                print('API进程退出，稍后恢复。',flush=True)
                if stopping:break
                until=time.monotonic()+delay
                while not stopping and time.monotonic()<until:time.sleep(.1)
                if stopping:break
                # A port taken while our process was down belongs to someone else.
                if listening('127.0.0.1',PORT):raise RuntimeError('恢复时主端口被其它服务占用，已停止后台管理')
                api=spawn('api', api_command(PORT));state['restarts']+=1;write_state(state);delay=min(delay*2,15)
            time.sleep(.25)
    except Exception as e:
        # Do not include connection URLs or environment values in logs.
        print('后台启动/监督失败：'+type(e).__name__+'；检查依赖配置与前面的日志。',flush=True);exit_code=1
    finally:
        state['stopping'] = True
        write_state(state)
        if api is not None and api.poll() is None:
            api.terminate();api.wait() # Wait for in-flight generation; no forced kill.
        if storage is not None and storage.poll() is None:storage.terminate();storage.wait()
        if read_state().get('pid')==os.getpid():STATE.unlink(missing_ok=True)
        fcntl.flock(lock,fcntl.LOCK_UN);lock.close()
    return exit_code

def reload_api():
    state = read_state()
    owner = supervisor(state)
    pid = state.get('api_pid')
    proc = process(pid)
    if not owner:
        return {**status(), 'error':'本项目监督进程未运行，请先 stop 再 start'}, 1
    if not matches_command(proc, api_command(state.get('port', PORT))) or proc.parent != owner.pid:
        return {**status(), 'error':'API 子进程身份不匹配'}, 1
    request_stop(proc)
    until=time.monotonic()+25;result=status()
    while time.monotonic()<until:
        result=status()
        if result.get('status')=='ready' and result.get('api_pid')!=pid:return result,0
        time.sleep(.2)
    return {**result,'error':'API仍在退出或恢复，请用status查看；没有强制结束任务或存储'},1

def stop_service():
    deadline = time.monotonic() + 10
    state = read_state()
    owner = supervisor(state)
    if owner:
        if not state.get('stopping'):
            request_stop(owner)
        if not wait_for_exit(owner, deadline):
            return status(), 0
        state = read_state()

    api, storage = managed_children(state)
    if api or storage:
        state['stopping'] = True
        write_state(state)
        for child in (api, storage):
            request_stop(child)
            if not wait_for_exit(child, deadline):
                result = status()
                result['message'] = '遗留进程仍在退出，请稍后再次运行 ./stop.sh 完成停机'
                return result, 0 if result['status'] in ('stopping', 'stopped') else 1
    result = status()
    if result['status'] == 'stopped':
        STATE.unlink(missing_ok=True)
        return result, 0
    return result, 1


def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['start','status','stop','reload','_run']);parser.add_argument('--json',action='store_true');args=parser.parse_args()
    if args.action=='_run':return supervise()
    RUN.mkdir(parents=True,exist_ok=True)
    with open(RUN/'control.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if args.action=='status':result=status();code=0 if result['status']=='ready' else 1
        elif args.action=='reload':result,code=reload_api()
        elif args.action=='stop':result,code=stop_service()
        else:
            state=read_state()
            if supervisor(state):result=status();code=0 if result['status']=='ready' else 1
            elif any(managed_children(state)):
                result={**status(), 'error':'发现云鹭遗留进程，请先运行 ./stop.sh'}
                code=1
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

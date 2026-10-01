import {DatabaseSync} from 'node:sqlite';
import {manualCaseSchema} from './manual-fixtures.mjs';
import {mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
export function database(dir) {
  mkdirSync(dir,{recursive:true,mode:0o700});mkdirSync(join(dir,'media'),{recursive:true,mode:0o700});
  const keyfile=join(dir,'vault.key');
  if(!existsSync(keyfile))writeFileSync(keyfile,randomBytes(32),{mode:0o600,flag:'wx'});
  const db=new DatabaseSync(join(dir,'cloudheron.sqlite'));
  chmodSync(join(dir,'cloudheron.sqlite'),0o600);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_id TEXT REFERENCES users(id),visibility TEXT NOT NULL,acl TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),name TEXT NOT NULL,document TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),title TEXT NOT NULL,messages TEXT NOT NULL DEFAULT '[]',updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),owner_id TEXT REFERENCES users(id),name TEXT NOT NULL,kind TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,visibility TEXT NOT NULL,acl TEXT NOT NULL DEFAULT '{}',mime TEXT NOT NULL,file TEXT NOT NULL,metadata TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS models (id TEXT PRIMARY KEY,name TEXT NOT NULL,spec TEXT NOT NULL,secret TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY,name TEXT NOT NULL,task TEXT NOT NULL,template TEXT NOT NULL,builtin INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS experts (id TEXT PRIMARY KEY,name TEXT NOT NULL,task TEXT NOT NULL,skill_ids TEXT NOT NULL,builtin INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY,workflow_id TEXT REFERENCES workflows(id),user_id TEXT REFERENCES users(id),base_revision INTEGER NOT NULL,document TEXT NOT NULL,explanation TEXT NOT NULL,expires INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending');
    CREATE TABLE IF NOT EXISTS publications (id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),workflow_id TEXT REFERENCES workflows(id),owner_id TEXT REFERENCES users(id),name TEXT NOT NULL,version TEXT NOT NULL,document TEXT NOT NULL,key_hash TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),owner_id TEXT REFERENCES users(id),source TEXT NOT NULL,source_id TEXT NOT NULL,publication_id TEXT REFERENCES publications(id),snapshot TEXT NOT NULL,status TEXT NOT NULL,steps TEXT NOT NULL DEFAULT '{}',outputs TEXT NOT NULL DEFAULT '[]',error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS jobs_source ON jobs(source_id,created_at);
    CREATE INDEX IF NOT EXISTS assets_project ON assets(project_id);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);`);
  db.exec(manualCaseSchema);
  const one=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
  const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
  run("UPDATE jobs SET status='failed',error='服务重启中断任务，请检查当前产物后重新运行',updated_at=? WHERE status IN ('queued','running')",new Date().toISOString());
  for(const [id,name,task,template] of [
    ['skill_visual','画面提示词','image','主体、环境、光线与构图：{{prompt}}'],
    ['skill_motion','视频动作描述','video','明确主体动作与运镜，避免无关切换：{{prompt}}'],
    ['skill_reference','参考资产注入','all','保持参考资产的外观、服装与风格。{{prompt}}'],
    ['skill_structure','提示词结构整理','prompt','将创作要求组织为主体、环境、光线、构图或动作，保留用户约束：{{prompt}}'],
    ['skill_concise','提示词精炼','prompt','去除重复描述，保留可执行的视觉信息，只输出提示词：{{prompt}}']])
    run('INSERT OR IGNORE INTO skills(id,name,task,template,builtin) VALUES(?,?,?,?,1)',id,name,task,template);
  for(const [eid,name,task,ids] of [['expert_image','画面创作专家','image',['skill_visual','skill_reference']],['expert_video','动态影像专家','video',['skill_motion','skill_reference']],['expert_prompt','提示词整理专家','prompt',['skill_structure','skill_concise']]])run('INSERT OR IGNORE INTO experts(id,name,task,skill_ids,builtin) VALUES(?,?,?,?,1)',eid,name,task,JSON.stringify(ids));
  return {db,one,all,run,tx,key:readFileSync(keyfile),dir};
}

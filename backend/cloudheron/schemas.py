from typing import Any,Literal
from pydantic import BaseModel,ConfigDict,Field
from datetime import datetime

class Contract(BaseModel): model_config=ConfigDict(extra='forbid')
class ErrorOut(BaseModel): error:str
class Ok(BaseModel): ok:bool=True
class UserOut(BaseModel): id:str;name:str;email:str;role:Literal['admin','editor','viewer'];active:bool
class SessionOut(BaseModel): user:UserOut
class MeOut(SessionOut): team:str
class Login(Contract): email:str;password:str=Field(min_length=10,max_length=200)
class Setup(Login): team:str;name:str
class Join(Contract): token:str;password:str=Field(min_length=10,max_length=200)
class ChangePassword(Contract): current:str;password:str=Field(min_length=10,max_length=200)
class Invite(Contract): email:str;name:str;role:Literal['admin','editor','viewer']
class UpdateUser(Contract): name:str;role:Literal['admin','editor','viewer'];active:bool;password:str=''
class InvitationOut(BaseModel): user:UserOut;invite_path:str
class ProjectCreate(Contract): name:str;visibility:Literal['team','private']='private'
class ProjectUpdate(ProjectCreate): acl:dict[str,Literal['read','edit']]
class ProjectOut(BaseModel): id:str;name:str;owner_id:str;visibility:str;acl:dict[str,str]={};created_at:datetime;can_edit:bool|None=None
class ModelWrite(Contract): name:str;spec:dict[str,Any];api_key:str|None=None;enabled:bool=True
class ModelOut(BaseModel): id:str;name:str;enabled:bool;has_key:bool;spec:dict[str,Any]
class WorkflowCreate(Contract): project_id:str;name:str;document:dict[str,Any]|None=None
class WorkflowValidate(Contract): project_id:str;document:dict[str,Any]
class WorkflowSave(Contract): revision:int=Field(ge=1);document:dict[str,Any]
class Revision(Contract): revision:int=Field(ge=1)
class Restore(Revision): source_revision:int=Field(ge=1)
class JobOut(BaseModel):
    id:str;project_id:str;owner_id:str;source:str;source_id:str;publication_id:str|None=None
    status:Literal['queued','running','completed','failed'];steps:dict[str,Any];outputs:list[str];error:str|None=None
    created_at:datetime;updated_at:datetime
class WorkflowOut(BaseModel): id:str;project_id:str;name:str;document:dict[str,Any];revision:int;updated_at:datetime;can_edit:bool|None=None;job:JobOut|None=None
class ChatCreate(Contract): project_id:str;title:str
class ChatMessage(Contract): prompt:str=Field(min_length=1,max_length=32000);config:dict[str,Any]
class ChatOut(BaseModel): id:str;project_id:str;title:str;messages:list[dict[str,Any]]|None=None;updated_at:datetime;can_edit:bool|None=None;job:JobOut|None=None
class AssetCreate(Contract): name:str;kind:Literal['image','video','character','scene','prop','style'];visibility:Literal['team','private'];mime:str;base64:str;filename:str;project_id:str|None=None;parent_id:str|None=None;description:str=''
class AssetUpdate(Contract): name:str;visibility:Literal['team','private'];description:str=''
class AssetOut(BaseModel): id:str;project_id:str|None=None;owner_id:str;name:str;kind:str;version:int;visibility:str;acl:dict[str,str]={};mime:str;metadata:dict[str,Any];created_at:datetime;url:str
class DownloadOut(BaseModel): url:str;expires_in:int=300
class SkillWrite(Contract): name:str;task:Literal['image','video','prompt','all'];template:str
class SkillOut(SkillWrite): id:str;builtin:bool
class ExpertWrite(Contract): name:str;task:Literal['image','video','prompt','all'];skill_ids:list[str]=Field(min_length=2,max_length=20)
class ExpertOut(ExpertWrite): id:str;builtin:bool
class TemplateSave(Contract): workflow_id:str;revision:int;name:str;description:str=''
class TemplateInstantiate(Contract): project_id:str;revision:int;name:str;keep_bindings:bool=False
class TemplateOut(BaseModel): source_workflow_id:str|None=None;source_revision:int|None=None;updated_at:datetime|None=None;id:str;project_id:str|None=None;owner_id:str|None=None;name:str;description:str;revision:int;builtin:bool=False;node_count:int;edge_count:int;document:dict[str,Any]|None=None
class Assist(Contract): mode:Literal['analyze','modify'];model_id:str;prompt:str=Field(min_length=1,max_length=10000);params:dict[str,Any]={}
class AnalysisOut(BaseModel): analysis:str
class ProposalOut(BaseModel): id:str;base_revision:int;explanation:str;before:dict[str,Any];after:dict[str,Any]
class PublicationCreate(Contract): workflow_id:str;name:str;version:str
class PublicationCreated(BaseModel): id:str;token:str;path:str;version:str
class PublicationOut(BaseModel): id:str;project_id:str;workflow_id:str;owner_id:str;name:str;version:str;enabled:bool;created_at:datetime
class ApiRun(Contract): prompt:str=Field(min_length=1,max_length=32000)
class ApiOutput(BaseModel): asset_id:str;url:str
class ApiJobOut(JobOut): outputs:list[ApiOutput]
class HealthOut(BaseModel): status:Literal['ok','ready','draining'];version:str;database:str='postgresql';storage:str='s3'
class RuntimeOut(BaseModel): version:str;state:str;workers:dict[str,Any];max_pending_per_user:int;queued:int;running:int
class BootstrapOut(BaseModel): setup_required:bool;team:str;node_types:dict[str,Any]
class AgentOut(BaseModel): id:str;name:str;description:str;model_capability:str;fields:list[str];defaults:dict[str,Any]

class ModelCheckOut(BaseModel):
    ok:bool;status:Literal['success','warning','failed'];note:str;elapsed_ms:int;models:list[str];model_available:bool|None=None

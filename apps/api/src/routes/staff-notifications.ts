import type { Express, Request, Response, RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import type { RequestAuthentication, TenantContext } from '../middleware/tenant-context.js';
import type { PracticeAccess } from './practice-access.js';
import type * as service from '../services/staff-notifications.service.js';
import { body, id, revision, WorkflowError } from '../workflow/policy.js';
import { canReadStaffWork } from '../notifications/staff-notification-policy.js';
import { logFailure } from '../logging.js';

export type StaffNotificationDependencies=Pick<typeof service,'staffNotifications'|'staffNotification'|'updateStaffNotification'|'readAllStaffNotifications'|'staffNotificationPreferences'|'saveStaffNotificationPreferences'|'staffNotificationPolicy'|'saveStaffNotificationPolicy'> & {recordStaffNotificationFailure?:typeof service.recordStaffNotificationFailure};
export function registerStaffNotificationRoutes(app:Express,access:PracticeAccess,getAuth:(req:Request)=>RequestAuthentication,deps:StaffNotificationDependencies){
  const base='/api/v1/locations/:locationId/workflow';
  async function fail(res:Response,error:unknown){const e=error as {code?:string;status?:number};const status=typeof e.status==='number'?e.status:500;const code=status<500&&typeof e.code==='string'?e.code:'NOTIFICATIONS_UNAVAILABLE';try{await deps.recordStaffNotificationFailure?.(res.locals.staffNotificationTenant??null,code,status,String(res.getHeader('X-Request-Id')??randomUUID()));}catch{logFailure('Staff notification failure evidence unavailable',new Error('NOTIFICATION_AUDIT_UNAVAILABLE'));}if(status>=500)logFailure('Staff notifications unavailable',new Error(code));res.status(status).json({error:{code,message:status>=500?'Notifications could not be loaded. Please try again.':code.toLowerCase().replaceAll('_',' ')+'.',retryable:status>=500}});}
  const authorize:RequestHandler=async(req,res,next)=>{try{const context=await access.authorizeLocation(getAuth(req),id(req.params.locationId));res.locals.staffNotificationTenant=context.tenant;res.locals.staffNotificationAccess={permissions:context.permissions??[]};res.setHeader('Cache-Control','no-store');res.setHeader('X-Request-Id',randomUUID());next();}catch(error){await fail(res,error);}};
  const route=(operation:(req:Request,res:Response,t:TenantContext,a:{permissions:string[]},requestId:string)=>Promise<unknown>,permission?:string):RequestHandler=>async(req,res)=>{try{const a=res.locals.staffNotificationAccess;if(permission?!a.permissions.includes(permission):!canReadStaffWork(a.permissions))throw new WorkflowError('FORBIDDEN',403);res.json({data:await operation(req,res,res.locals.staffNotificationTenant,a,res.getHeader('X-Request-Id') as string)});}catch(error){await fail(res,error);}};
  const context=(req:Request,res:Response,precondition=true)=>({requestId:String(res.getHeader('X-Request-Id')),idempotencyKey:req.get('Idempotency-Key'),...(precondition?{expectedRevision:revision(req.get('If-Match'))}:{})});
  app.get(base+'/notifications',authorize,route((req,_res,t,a,r)=>{for(const k of Object.keys(req.query))if(!['filter','cursor','limit'].includes(k))throw new WorkflowError('INVALID_QUERY',400);return deps.staffNotifications(t,a,req.query,r);}));
  app.post(base+'/notifications/read-all',authorize,route((req,res,t,a)=>deps.readAllStaffNotifications(t,a,req.body,context(req,res,false))));
  app.get(base+'/notifications/:id',authorize,route((req,_res,t,a,r)=>deps.staffNotification(t,a,id(req.params.id),r)));
  for(const action of ['read','archive','snooze'] as const)app.post(base+`/notifications/:id/${action}`,authorize,route((req,res,t,a)=>deps.updateStaffNotification(t,a,id(req.params.id),action,req.body,context(req,res))));
  app.get(base+'/notification-preferences',authorize,route((_req,_res,t,_a,r)=>deps.staffNotificationPreferences(t,r)));
  app.patch(base+'/notification-preferences',authorize,route((req,res,t)=>deps.saveStaffNotificationPreferences(t,req.body,context(req,res))));
  app.get(base+'/notification-policy',authorize,route((_req,_res,t,_a,r)=>deps.staffNotificationPolicy(t,r,true),'org:workflow:configure'));
  app.patch(base+'/notification-policy',authorize,route((req,res,t)=>deps.saveStaffNotificationPolicy(t,req.body,context(req,res)),'org:workflow:configure'));
}

import type { Express,Request,Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { RequestAuthentication } from '../middleware/tenant-context.js';
import { portalPrincipal } from '../workflow/paperwork-policy.js';
import { revision,WorkflowError } from '../workflow/policy.js';
import { logFailure } from '../logging.js';

type PortalRead=typeof import('../services/patient-paperwork.service.js').portalPaperwork;
type FailureRecorder=typeof import('../services/workflow-audit.js').recordAnonymousWorkflowFailure;
const defaultPortalRead:PortalRead=async(...args)=>(await import('../services/patient-paperwork.service.js')).portalPaperwork(...args);
const defaultFailureRecorder:FailureRecorder=async(event)=>{const a=event.authorization;if(event.outcome==='denied'&&typeof a?.portalSubject==='string'&&typeof a?.portalSession==='string')return(await import('../services/patient-paperwork.service.js')).recordPortalPaperworkFailure(a.portalSubject,a.portalSession,event.reasonCode??'PAPERWORK_UNAVAILABLE',event.requestId??randomUUID());return(await import('../services/workflow-audit.js')).recordAnonymousWorkflowFailure(event);};

type PatientRouteOptions={base:string;token:(req:Request)=>string;requestId:(res:Response)=>string;fail:(error:unknown,req:Request,res:Response)=>Promise<void>};
/** Register only after the existing restricted patient middleware (origin/rate limit/body/cache). */
export function registerPatientPaperworkRoutes(app:Express,options:PatientRouteOptions) {
    app.put(options.base+'/form/answers',async(req,res)=>{
        try{const {patientFormAnswers}=await import('../services/patient-paperwork.service.js');const data=await patientFormAnswers(options.token(req),req.body,req.get('Idempotency-Key')??'',revision(req.get('If-Match')),options.requestId(res));res.json({data});}catch(error){await options.fail(error,req,res);}
    });
    app.post(options.base+'/form/freeze',async(req,res)=>{
        try{const {patientFormFreeze}=await import('../services/patient-paperwork.service.js');const data=await patientFormFreeze(options.token(req),req.body,req.get('Idempotency-Key')??'',revision(req.get('If-Match')),options.requestId(res));res.json({data});}catch(error){await options.fail(error,req,res);}
    });
}
/** This library uses a verified account and explicit grant, never a request cookie. */
export function registerPatientPaperworkPortalRoutes(app:Express,getAuth:(req:Request)=>RequestAuthentication,read:PortalRead=defaultPortalRead,recordFailure:FailureRecorder=defaultFailureRecorder) {
    const base='/api/v1/patient-paperwork';
    app.use(base,(_req,res,next)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');next();});
    const fail=async(error:unknown,req:Request,res:Response)=>{
        const requestId=randomUUID();res.setHeader('X-Request-Id',requestId);
        const code=error instanceof WorkflowError?error.code:(error as {code?:string})?.code==='42501'?'PAPERWORK_COPY_NOT_FOUND':'PAPERWORK_UNAVAILABLE';
        const status=error instanceof WorkflowError?error.status:code==='PAPERWORK_COPY_NOT_FOUND'?404:503;
        let principal:ReturnType<typeof portalPrincipal>|null=null;try{principal=portalPrincipal(getAuth(req));}catch{}
        try{await recordFailure({...(principal?{authorization:{portalSubject:principal.subject,portalSession:principal.sessionId}}:{}),action:'paperwork.portal.request.failed',entityType:'http_request',outcome:status===401||status===403||status===404?'denied':status>=500?'failed':'rejected',reasonCode:code,requestId,metadata:{code}});}catch(auditError){logFailure('Patient paperwork failure audit unavailable',auditError);}
        if(status>=500)logFailure('Patient paperwork unavailable',new Error(code));
        res.status(status).json({error:{code,message:status===401?'Sign in to view your paperwork.':status===404?'This copy is unavailable.':'Your paperwork could not be loaded.',requestId,retryable:status>=500}});
    };
    app.get(base,async(req,res)=>{
        try{const principal=portalPrincipal(getAuth(req));if(req.query.cursor!==undefined&&typeof req.query.cursor!=='string')throw new WorkflowError('INVALID_PAPERWORK_CURSOR',400);res.json({data:await read(principal.subject,principal.sessionId,undefined,req.query.cursor as string|undefined)});}catch(error){await fail(error,req,res);}
    });
    app.get(base+'/:id/content',async(req,res)=>{
        try{const principal=portalPrincipal(getAuth(req));const result=await read(principal.subject,principal.sessionId,String(req.params.id));if(!('bytes' in result)||!result.bytes)throw new WorkflowError('DOCUMENT_UNAVAILABLE',404);res.setHeader('Content-Type',result.contentType);res.setHeader('Content-Disposition',"inline; filename*=UTF-8''"+encodeURIComponent(result.filename??'paperwork.pdf'));res.send(result.bytes);}catch(error){await fail(error,req,res);}
    });
}

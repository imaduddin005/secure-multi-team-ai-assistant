import 'reflect-metadata';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { APP_GUARD } from '@nestjs/core';
import { json } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { IdentityGuard, SupabaseTokenVerifier } from './auth';
import { config } from './config';
import { Database } from './database';
import { CompatibleAI, SupabaseStorage } from './providers';
import { TeamsController } from './teams.controller';
import { DocumentsController } from './documents.controller';
import { AdminController, ChatController } from './chat.controller';
import type { AppContext } from './types';

const codes:Record<string,[number,string]>={FORBIDDEN:[403,'Access denied'],NOT_FOUND:[404,'Resource unavailable'],LAST_ADMIN:[409,'The last active team admin cannot be removed or demoted'],
  ALREADY_MEMBER:[409,'Membership already active'],INVALID_READER:[400,'Invalid team reader'],UPLOAD_EXPIRED:[409,'Upload expired; try again'],
  QUOTA_EXCEEDED:[429,'Team monthly answer limit reached'],IDEMPOTENCY_CONFLICT:[409,'Request key was already used for different content'],
  IN_PROGRESS:[409,'This request is already processing'],STALE_ATTEMPT:[409,'Request expired; retry'],SOURCE_UNAVAILABLE:[409,'Sources are no longer available'],
  PROFILE_MISMATCH:[503,'Assistant configuration requires administrator attention']};
@Catch()
class SafeErrors implements ExceptionFilter {
  constructor(private readonly ctx:AppContext){}
  catch(error:any,host:ArgumentsHost){
    const http=host.switchToHttp();const request=http.getRequest();const response=http.getResponse();
    let status=500;let message='Service unavailable';
    if(error instanceof ZodError){status=400;message='Invalid request fields';}
    else if(error instanceof HttpException){status=error.getStatus();const body=error.getResponse();message=typeof body==='string'?body:(body as any).message;}
    else if(codes[error?.message]){[status,message]=codes[error.message]!;}
    else if(['23503','23505','23514'].includes(error?.code)){status=409;message='Operation conflicts with a database rule';}
    else if(['22P02','22023'].includes(error?.code)){status=400;message='Invalid request fields';}
    if([401,403,404].includes(status)){
      const team=request.params?.teamId;const safeTeam=typeof team==='string'&&/^[0-9a-f-]{36}$/i.test(team)?team:null;
      void this.ctx.db.pool.query('SELECT app_private.security_event($1,$2,$3)',[request.userId||null,safeTeam,request.requestId]).catch(()=>{});
    }
    response.status(status).json({statusCode:status,message,requestId:request.requestId});
  }
}
export async function createApp(overrides?:Partial<AppContext>){
  if(overrides && process.env.NODE_ENV!=='test')throw new Error('Dependency overrides are test-only');
  const cfg=overrides?.cfg||config();
  const ctx:AppContext={cfg,db:overrides?.db||new Database(cfg.apiDatabaseUrl),verifier:overrides?.verifier||new SupabaseTokenVerifier(cfg),
    storage:overrides?.storage||new SupabaseStorage(cfg),ai:overrides?.ai||new CompatibleAI(cfg)};
  @Module({controllers:[TeamsController,DocumentsController,ChatController,AdminController],providers:[{provide:'CONTEXT',useValue:ctx},
    {provide:APP_GUARD,useValue:new IdentityGuard(ctx.verifier,ctx.db)}]})class ApplicationModule{}
  const app=await NestFactory.create(ApplicationModule,{logger:false,bodyParser:false});
  app.use(helmet());app.use(json({limit:'32kb'}));
  app.enableCors({origin:cfg.webOrigin,allowedHeaders:['Authorization','Content-Type'],exposedHeaders:['Content-Disposition','X-Request-Id'],methods:['GET','POST','PATCH','DELETE'],credentials:false});
  const buckets=new Map<string,{count:number;until:number}>();
  app.use((request:any,response:any,next:()=>void)=>{
    request.requestId=randomUUID();response.setHeader('X-Request-Id',request.requestId);response.setHeader('Cache-Control','private, no-store');
    const now=Date.now();const key=request.ip||'unknown';let bucket=buckets.get(key);
    if(!bucket||bucket.until<now){bucket={count:0,until:now+60000};buckets.set(key,bucket);}
    if(buckets.size>10000){for(const [id,value]of buckets)if(value.until<now)buckets.delete(id);
      while(buckets.size>10000)buckets.delete(buckets.keys().next().value!);}
    if(++bucket.count>120)return response.status(429).json({message:'Too many requests'});
    next();
  });
  app.useGlobalFilters(new SafeErrors(ctx));
  await app.init();
  return {app,ctx,close:async()=>{await app.close();await ctx.db.close();}};
}

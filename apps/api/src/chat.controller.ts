import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { uuid } from './config';
import { answerQuestion } from './chat';
import type { AppContext } from './types';

@Controller('teams/:teamId')
export class ChatController {
  constructor(@Inject('CONTEXT')private readonly ctx:AppContext){}
  private run(r:any,t:string,operation:string,payload:unknown={}){return this.ctx.db.command(r.userId,uuid.parse(t),'chat',operation,payload,r.requestId);}
  @Get('conversations')list(@Req()r:any,@Param('teamId')t:string){return this.run(r,t,'conversations');}
  @Post('conversations')create(@Req()r:any,@Param('teamId')t:string){return this.run(r,t,'create');}
  @Get('conversations/:conversationId/messages')history(@Req()r:any,@Param('teamId')t:string,@Param('conversationId')c:string){return this.run(r,t,'history',{conversationId:uuid.parse(c)});}
  @Delete('conversations/:conversationId')remove(@Req()r:any,@Param('teamId')t:string,@Param('conversationId')c:string){return this.run(r,t,'delete_conversation',{conversationId:uuid.parse(c)});}
  @Post('conversations/:conversationId/messages')ask(@Req()r:any,@Param('teamId')t:string,@Param('conversationId')c:string,@Body()body:unknown){
    const value=z.object({question:z.string().trim().min(1).max(8000),idempotencyKey:z.string().min(1).max(200)}).strict().parse(body);
    return answerQuestion(this.ctx,r.userId,uuid.parse(t),uuid.parse(c),value.question,value.idempotencyKey,r.requestId);
  }
  @Patch('messages/:messageId/feedback')feedback(@Req()r:any,@Param('teamId')t:string,@Param('messageId')m:string,@Body()body:unknown){
    const value=z.object({rating:z.enum(['helpful','unhelpful']),comment:z.string().max(2000).optional()}).strict().parse(body);
    return this.run(r,t,'feedback',{...value,messageId:uuid.parse(m)});
  }
  @Get('messages/:messageId/sources/:label')citation(@Req()r:any,@Param('teamId')t:string,@Param('messageId')m:string,@Param('label')label:string){
    return this.run(r,t,'citation',{messageId:uuid.parse(m),label:z.string().regex(/^S[1-9][0-9]*$/).parse(label)});
  }
}
@Controller('teams/:teamId/admin')
export class AdminController {
  constructor(@Inject('CONTEXT')private readonly ctx:AppContext){}
  @Get('usage')usage(@Req()r:any,@Param('teamId')t:string){return this.ctx.db.command(r.userId,uuid.parse(t),'admin','usage',{},r.requestId);}
  @Get('audit')audit(@Req()r:any,@Param('teamId')t:string){return this.ctx.db.command(r.userId,uuid.parse(t),'admin','audit',{},r.requestId);}
  @Patch('budget')budget(@Req()r:any,@Param('teamId')t:string,@Body()body:unknown){
    return this.ctx.db.command(r.userId,uuid.parse(t),'admin','budget',z.object({limit:z.number().int().min(0).max(1000000)}).strict().parse(body),r.requestId);
  }
}

import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { maxUpload, uuid } from './config';
import type { AppContext } from './types';

export function validateUpload(bytes:Uint8Array,name:string):{filename:string;mime:string} {
  if(!bytes.length||bytes.length>maxUpload)throw new BadRequestException('File must be between 1 byte and 20 MiB');
  const filename=(name.split(/[\\/]/).pop() || 'document').replace(/[\r\n\x00-\x1f]/g,'').slice(0,200);
  if(filename.toLowerCase().endsWith('.pdf') && Buffer.from(bytes.subarray(0,5)).toString()==='%PDF-')return {filename,mime:'application/pdf'};
  if(!filename.toLowerCase().endsWith('.txt'))throw new BadRequestException('Only text PDF and UTF-8 TXT are supported');
  try { const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(text.includes('\0')||!text.trim())throw new Error(); }
  catch {throw new BadRequestException('TXT must contain valid nonempty UTF-8 text');}
  return {filename,mime:'text/plain'};
}
@Controller('teams/:teamId/documents')
export class DocumentsController {
  constructor(@Inject('CONTEXT')private readonly ctx:AppContext){}
  private run(request:any,team:string,operation:string,payload:unknown={}) {
    return this.ctx.db.command(request.userId,uuid.parse(team),'document',operation,payload,request.requestId);
  }
  @Get()list(@Req()r:any,@Param('teamId')team:string,@Query()query:unknown){
    const value=z.object({q:z.string().max(200).default(''),offset:z.coerce.number().int().min(0).max(10000).default(0)}).strict().parse(query);
    return this.run(r,team,'list',{query:value.q,offset:value.offset});}
  @Get(':documentId/versions')versions(@Req()r:any,@Param('teamId')team:string,@Param('documentId')id:string){return this.run(r,team,'versions',{documentId:uuid.parse(id)});}
  @Get(':documentId/readers')readers(@Req()r:any,@Param('teamId')team:string,@Param('documentId')id:string){return this.run(r,team,'readers',{documentId:uuid.parse(id)});}
  @Post()
  @UseInterceptors(FileInterceptor('file',{storage:memoryStorage(),limits:{fileSize:maxUpload,files:1,fields:1}}))
  upload(@Req()r:any,@Param('teamId')team:string,@UploadedFile()file:any,@Body()body:unknown){return this.store(r,team,file,body);}
  @Post(':documentId/versions')
  @UseInterceptors(FileInterceptor('file',{storage:memoryStorage(),limits:{fileSize:maxUpload,files:1,fields:1}}))
  version(@Req()r:any,@Param('teamId')team:string,@Param('documentId')id:string,@UploadedFile()file:any,@Body()body:unknown){return this.store(r,team,file,body,uuid.parse(id));}
  private async store(r:any,team:string,file:any,body:unknown,documentId?:string){
    if(!file?.buffer)throw new BadRequestException('A file is required');
    const fields=z.object({title:z.string().trim().min(1).max(200).optional()}).strict().parse(body||{});
    const parsed=validateUpload(file.buffer,file.originalname);
    const intent=await this.run(r,team,'intent',{documentId,bucket:this.ctx.cfg.bucket});
    try {
      await this.ctx.storage.put(intent.objectKey,file.buffer,parsed.mime);
      return await this.run(r,team,'finalize',{intentId:intent.intentId,token:intent.token,title:fields.title||parsed.filename,
        filename:parsed.filename,mimeType:parsed.mime,byteSize:file.buffer.length,sha256:createHash('sha256').update(file.buffer).digest('hex')});
    } catch(error) {await this.run(r,team,'abandon',{intentId:intent.intentId}).catch(()=>{});throw error;}
  }
  @Get(':documentId/versions/:versionId/download')
  async download(@Req()r:any,@Param('teamId')team:string,@Param('documentId')id:string,@Param('versionId')version:string,@Res()response:any){
    const payload={documentId:uuid.parse(id),versionId:uuid.parse(version)};
    const plan=await this.run(r,team,'download',payload);
    const bytes=await this.ctx.storage.get(plan.objectKey);
    await this.run(r,team,'download',payload); // Recheck after remote I/O, before delivery.
    response.setHeader('Content-Type',plan.mimeType);
    response.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(plan.filename)}`);
    response.send(Buffer.from(bytes));
  }
  @Patch(':documentId/visibility')visibility(@Req()r:any,@Param('teamId')team:string,@Param('documentId')id:string,@Body()body:unknown){
    const value=z.object({visibility:z.enum(['team','restricted']),readers:z.array(uuid).max(500).default([])}).strict().parse(body);
    return this.run(r,team,'visibility',{...value,documentId:uuid.parse(id)});
  }
  @Post(':documentId/grants')grant(@Req()r:any,@Param('teamId')team:string,@Param('documentId')id:string,@Body()body:unknown){
    return this.run(r,team,'grant_add',{...z.object({membershipId:uuid}).strict().parse(body),documentId:uuid.parse(id)});
  }
  @Delete(':documentId/grants/:membershipId')revoke(@Req()r:any,@Param('teamId')team:string,@Param('documentId')id:string,@Param('membershipId')member:string){
    return this.run(r,team,'grant_revoke',{documentId:uuid.parse(id),membershipId:uuid.parse(member)});
  }
  @Delete(':documentId')remove(@Req()r:any,@Param('teamId')team:string,@Param('documentId')id:string){return this.run(r,team,'delete',{documentId:uuid.parse(id)});}
}

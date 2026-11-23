import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { memberInput, roleInput, uuid } from './config';
import type { AppContext } from './types';

@Controller()
export class TeamsController {
  constructor(@Inject('CONTEXT') private readonly ctx: AppContext) {}
  @Get('health') health() { return { status:'ok' }; }
  @Get('me') me(@Req() request: any) { return this.ctx.db.command(request.userId,undefined,'membership','me',{},request.requestId); }
  @Get('teams') teams(@Req() request: any) { return this.ctx.db.command(request.userId,undefined,'membership','teams',{},request.requestId); }
  @Get('teams/:teamId/members') members(@Req() request:any,@Param('teamId') team:string) {
    return this.ctx.db.command(request.userId,uuid.parse(team),'membership','members',{},request.requestId);
  }
  @Post('teams/:teamId/members') add(@Req() request:any,@Param('teamId') team:string,@Body() body:unknown) {
    return this.ctx.db.command(request.userId,uuid.parse(team),'membership','add',memberInput.parse(body),request.requestId);
  }
  @Patch('teams/:teamId/members/:membershipId') role(@Req() request:any,@Param('teamId') team:string,@Param('membershipId') member:string,@Body() body:unknown) {
    return this.ctx.db.command(request.userId,uuid.parse(team),'membership','role',{...roleInput.parse(body),membershipId:uuid.parse(member)},request.requestId);
  }
  @Delete('teams/:teamId/members/:membershipId') remove(@Req() request:any,@Param('teamId') team:string,@Param('membershipId') member:string) {
    return this.ctx.db.command(request.userId,uuid.parse(team),'membership','remove',{membershipId:uuid.parse(member)},request.requestId);
  }
}

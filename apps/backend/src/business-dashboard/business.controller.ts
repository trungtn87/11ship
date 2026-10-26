import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { AdminRequest, AdminTransport, Csrf } from '../admin-shippers/admin-shipper.controller';
import { AuthenticatedRequest } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { parseConfirmBody, parseRejectBody } from '../admin-topups/admin-topup-validation';
import { parseOverviewQuery } from '../admin-overview/admin-overview-validation';
import { BusinessFinanceService, FinanceIdentity } from './finance-service';
import { BusinessReportService } from './business-report-service';
import { BusinessPushService } from './business-push-service';
import { id, object, page, positive, sequence, text } from './finance-validation';

@Controller('admin/business')
export class BusinessAdminController {
  private readonly transport:AdminTransport;
  constructor(private readonly finance:BusinessFinanceService,private readonly reports:BusinessReportService,private readonly push:BusinessPushService,limiter:AdminLimiter,@Inject(ADMIN_AUTH_CONFIG)config:AdminAuthConfig){this.transport=new AdminTransport(limiter,config);}
  @Get('reports')
  reportsRead(@Req()r:AdminRequest,@Query()q:unknown){return this.reports.read(this.transport.read(r),parseOverviewQuery(q)).then(data=>({data}));}
  @Get('requests')
  async list(@Req()r:AdminRequest,@Query()q:unknown){const p=page(q);return {data:await this.finance.list(await this.finance.admin(this.transport.read(r)),p.state,p.before===null?null:id(p.before))};}
  @Get('requests/:id')
  async read(@Req()r:AdminRequest,@Param('id')value:string,@Query()q:unknown){const p=page(q);return {data:await this.finance.read(await this.finance.admin(this.transport.read(r)),id(value),p.before===null?null:sequence(p.before))};}
  @Post('requests/:id/messages') @HttpCode(200)
  async send(@Req()r:AdminRequest,@Param('id')value:string,@Body()body:unknown,@Headers('x-csrf-token')csrf:Csrf,@Headers('idempotency-key')key:Csrf){const who=await this.write(r,csrf);const b=object(body,['body']);return {data:await this.finance.send(who,id(value),text(b.body),key,r.requestId??randomUUID())};}
  @Post('requests/:id/read') @HttpCode(200)
  async seen(@Req()r:AdminRequest,@Param('id')value:string,@Body()body:unknown,@Headers('x-csrf-token')csrf:Csrf,@Headers('idempotency-key')key:Csrf){const who=await this.write(r,csrf);const b=object(body,['sequence']);return {data:await this.finance.seen(who,id(value),sequence(b.sequence),key,r.requestId??randomUUID())};}
  @Post('requests/:id/confirm') @HttpCode(200)
  async confirm(@Req()r:AdminRequest,@Param('id')value:string,@Body()body:unknown,@Headers('x-csrf-token')csrf:Csrf,@Headers('idempotency-key')key:Csrf){return {data:await this.finance.resolveShop(await this.write(r,csrf),id(value),'confirm',parseConfirmBody(body),key,r.requestId??randomUUID())};}
  @Post('requests/:id/reject') @HttpCode(200)
  async reject(@Req()r:AdminRequest,@Param('id')value:string,@Body()body:unknown,@Headers('x-csrf-token')csrf:Csrf,@Headers('idempotency-key')key:Csrf){return {data:await this.finance.resolveShop(await this.write(r,csrf),id(value),'reject',parseRejectBody(body),key,r.requestId??randomUUID())};}
  @Get('receiving-accounts')
  async accounts(@Req()r:AdminRequest){return {data:await this.finance.receivingAccounts(await this.finance.admin(this.transport.read(r)))};}
  @Get('policy')
  async policy(@Req()r:AdminRequest){return {data:await this.finance.policy(await this.finance.admin(this.transport.read(r)))};}
  @Post('policy') @HttpCode(200)
  async changePolicy(@Req()r:AdminRequest,@Body()body:unknown,@Headers('x-csrf-token')csrf:Csrf,@Headers('idempotency-key')key:Csrf){const b=object(body,['visible_limit','messages_per_minute','expected_version','reason']);return {data:await this.finance.changePolicy(await this.write(r,csrf),positive(b.visible_limit,300),positive(b.messages_per_minute,60),positive(b.expected_version),text(b.reason,300),key,r.requestId??randomUUID())};}
  @Get('shops/:id/entitlement')
  async entitlement(@Req()r:AdminRequest,@Param('id')value:string){return {data:await this.finance.entitlement(await this.finance.admin(this.transport.read(r)),id(value))};}
  @Post('shops/:id/entitlement') @HttpCode(200)
  async changeEntitlement(@Req()r:AdminRequest,@Param('id')value:string,@Body()body:unknown,@Headers('x-csrf-token')csrf:Csrf,@Headers('idempotency-key')key:Csrf){
    const b=object(body,['action','reason','expected_version','payment_request_id']);
    if(b.action!=='GRANT'&&b.action!=='REVOKE')throw new AppError('ADMIN_INPUT_INVALID');
    const reason=text(b.reason,300);if([...reason].length<3||[...reason].length>300)throw new AppError('ADMIN_INPUT_INVALID');
    return {data:await this.finance.changeEntitlement(await this.write(r,csrf),id(value),b.action,reason,sequence(b.expected_version),b.payment_request_id===null||b.payment_request_id===undefined?null:id(b.payment_request_id),key,r.requestId??randomUUID())};
  }
  @Get('notifications')
  async notifications(@Req()r:AdminRequest,@Query()q:unknown){return {data:await this.finance.notifications(await this.finance.admin(this.transport.read(r)),page(q).before===null?null:sequence(page(q).before))};}
  @Get('push')
  async pushStatus(@Req()r:AdminRequest){await this.finance.list(await this.finance.admin(this.transport.read(r)),'PENDING',null);return {data:this.push.status()};}
  @Post('push/subscribe') @HttpCode(200)
  async subscribe(@Req()r:AdminRequest,@Body()body:unknown,@Headers('x-csrf-token')csrf:Csrf,@Headers('idempotency-key')key:Csrf){return {data:await this.push.subscribe(await this.write(r,csrf),body,key,r.requestId??randomUUID())};}
  @Post('push/unsubscribe') @HttpCode(200)
  async unsubscribe(@Req()r:AdminRequest,@Body()body:unknown,@Headers('x-csrf-token')csrf:Csrf,@Headers('idempotency-key')key:Csrf){object(body,[]);return {data:await this.push.unsubscribe(await this.write(r,csrf),key,r.requestId??randomUUID())};}
  private async write(r:AdminRequest,csrf:unknown):Promise<FinanceIdentity>{return this.finance.admin(await this.transport.write(r),csrf,true);}
}
@UseGuards(SessionAuthGuard)
@Controller('finance/me')
export class BusinessClientController {
  constructor(private readonly finance:BusinessFinanceService){}
  private who(r:AuthenticatedRequest):FinanceIdentity{if(!r.auth)throw new AppError('SESSION_INVALID');return {kind:'client',principal:r.auth};}
  @Get('requests')
  async list(@Req()r:AuthenticatedRequest,@Query()q:unknown){const p=page(q);return {data:await this.finance.list(this.who(r),p.state,p.before===null?null:id(p.before))};}
  @Get('requests/:id')
  async read(@Req()r:AuthenticatedRequest,@Param('id')value:string,@Query()q:unknown){return {data:await this.finance.read(this.who(r),id(value),page(q).before===null?null:sequence(page(q).before))};}
  @Post('shop-payments') @HttpCode(201)
  async create(@Req()r:AuthenticatedRequest,@Body()body:unknown,@Headers('idempotency-key')key:Csrf){const b=object(body,['amount_vnd','note']);return {data:await this.finance.createShop(this.who(r),positive(b.amount_vnd),text(b.note),key,r.requestId??randomUUID())};}
  @Post('requests/:id/messages') @HttpCode(200)
  async send(@Req()r:AuthenticatedRequest,@Param('id')value:string,@Body()body:unknown,@Headers('idempotency-key')key:Csrf){const b=object(body,['body']);return {data:await this.finance.send(this.who(r),id(value),text(b.body),key,r.requestId??randomUUID())};}
  @Post('requests/:id/read') @HttpCode(200)
  async seen(@Req()r:AuthenticatedRequest,@Param('id')value:string,@Body()body:unknown,@Headers('idempotency-key')key:Csrf){const b=object(body,['sequence']);return {data:await this.finance.seen(this.who(r),id(value),sequence(b.sequence),key,r.requestId??randomUUID())};}
  @Get('receiving-accounts')
  async accounts(@Req()r:AuthenticatedRequest){return {data:await this.finance.receivingAccounts(this.who(r))};}
  @Post('requests/:id/report-transfer') @HttpCode(200)
  async report(@Req()r:AuthenticatedRequest,@Param('id')value:string,@Body()body:unknown,@Headers('idempotency-key')key:Csrf){object(body,[]);return {data:await this.finance.reportTransfer(this.who(r),id(value),key,r.requestId??randomUUID())};}
  @Get('notifications')
  async notifications(@Req()r:AuthenticatedRequest,@Query()q:unknown){return {data:await this.finance.notifications(this.who(r),page(q).before===null?null:sequence(page(q).before))};}
}

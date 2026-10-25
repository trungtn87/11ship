import { Injectable } from '@nestjs/common';
import { AdminSystemActor } from '../admin-provisioning/admin-system-actor';
import { AdminRightsReader } from '../admin-m12/admin-rights';
import { Period, resolvePeriod, vietnamDay } from '../admin-m12/vietnam-time';
import { OverviewQuery } from '../admin-overview/admin-overview-validation';
import { ReportBuilder, REPORT_KINDS } from '../admin-reports/report-builder';
import { TransactionManager } from '../transaction/transaction-manager';
import { JsonObject } from '../idempotency/idempotency-executor';
import { FINANCE_PERMISSION_READ, PERMISSION_REPORT_READ } from '../finance-access/finance-access-constants';
import { BusinessTradeReader } from '../orders/business-trade-reader';

/** Compare elapsed time with the same elapsed time in the preceding period; future hours never enter either side. */
export function comparisonPeriods(p:Period,now:number):{current:Period;previous:Period} {
  const current={...p,toMs:Math.min(p.toMs,now)};
  let start=p.fromMs-(p.toMs-p.fromMs);let end=p.fromMs;
  if(p.range==='month') {
    const date=new Date(p.fromMs+7*3600000);
    start=Date.UTC(date.getUTCFullYear(),date.getUTCMonth()-1,1)-7*3600000;
  }
  end=Math.min(end,start+Math.max(0,current.toMs-current.fromMs));
  return {current,previous:{range:'custom',fromMs:start,toMs:end,fromDay:vietnamDay(start),toDay:vietnamDay(Math.max(start,end-1))}};
}
@Injectable()
export class BusinessReportService {
  constructor(private readonly tx:TransactionManager,private readonly actor:AdminSystemActor,private readonly rights:AdminRightsReader,private readonly builder:ReportBuilder,private readonly trade:BusinessTradeReader) {}
  async read(token:string|undefined,query:OverviewQuery):Promise<JsonObject> {
    const known=await this.actor.precheck(token,{required:false});
    return this.tx.withTransaction(async c=>{
      const rights=await this.rights.read(c,known);rights.require(PERMISSION_REPORT_READ);
      const p=resolvePeriod(query.range,rights.nowMs,query.custom);const periods=comparisonPeriods(p,rights.nowMs);
      const reports:JsonObject={};
      for(const kind of REPORT_KINDS){
        if(kind==='money'&&!rights.has(FINANCE_PERMISSION_READ)){reports[kind]={status:'FORBIDDEN'};continue;}
        const current=await this.builder.build(c,kind,periods.current,'created',rights,100);
        const previous=await this.builder.build(c,kind,periods.previous,'created',rights,100);
        reports[kind]={status:'OK',current:JSON.parse(JSON.stringify(current)) as JsonObject,previous:JSON.parse(JSON.stringify(previous)) as JsonObject};
      }
      const trade=await this.trade.summary(c,periods.current,rights.has(FINANCE_PERMISSION_READ));
      const previousTrade=await this.trade.summary(c,periods.previous,rights.has(FINANCE_PERMISSION_READ));
      return {generated_at:new Date(rights.nowMs).toISOString(),time_zone:'Asia/Ho_Chi_Minh',period:{from_day:p.fromDay,to_day:p.toDay,from:new Date(periods.current.fromMs).toISOString(),to:new Date(periods.current.toMs).toISOString()},previous_period:{from:new Date(periods.previous.fromMs).toISOString(),to:new Date(periods.previous.toMs).toISOString()},comparison_label:'So với cùng khoảng thời gian của kỳ trước',trade,previous_trade:previousTrade,reports};
    });
  }
}

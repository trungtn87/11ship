import { AdminAuthController } from './controller.js';
export interface FinanceRequest {request_id:string;shop_id:string|null;reported_at:string|null;kind:'TOPUP'|'SHOP_PAYMENT';label:string;state:string;version:number;amount_requested_vnd:number;actual_amount_vnd:number|null;created_at:string;resolved_at:string|null;unread:number}
export interface FinanceMessage {sequence:string;role:string;sender_name:string|null;body:string;created_at:string}
export interface Entitlement {shop_id:string;expanded:boolean;version:string;history:{action:string;reason:string;created_at:string}[]}
export interface FinanceRoom {capabilities:{can_send:boolean;can_record:boolean;can_manage_entitlement:boolean};entitlement:Entitlement|null;request:FinanceRequest;messages:{items:FinanceMessage[];has_more:boolean;next_before:string|null}}
export interface FinanceList {items:FinanceRequest[];has_more:boolean;next_before:string|null}
export interface Notices {unread:number;items:{sequence:string;request_id:string;kind:string;created_at:string;unread:boolean}[];next_before:string|null}
export interface Summary {key:string;label:string;value:number|string|null;format:string;note?:string}
export interface Report {title:string;basisLabel:string;summary:Summary[];columns:{key:string;label:string;format:string}[];rows:{cells:(number|string|null)[]}[];notes:string[];truncated:boolean}
export interface Trade {transactions:number;goods_vnd:number;goods_note:string;shops:number;active_shops:number;shippers:number;online_shippers:number;ranking_truncated:boolean;ranking:{name:string;orders:number;goods_vnd:number}[];quality:{reviews:number;average_stars:number|null;complaints:number;average_resolution_seconds:number|null};shop_payments:{status:string;confirmed_vnd?:number;confirmed_count?:number}}
export interface BusinessReports {generated_at:string;period:{from_day:string;to_day:string};comparison_label:string;trade:Trade;previous_trade:Trade;reports:Record<string,{status:string;current?:Report;previous?:Report}>}
export class BusinessApiError extends Error {constructor(readonly code:string,readonly status:number){super(code);}}
export class BusinessApi {
  // Kept only in memory. A retry of an uncertain mutation reuses its logical request's key.
  private epoch=0;
  private readonly pending=new Map<string,string>();
  constructor(private readonly auth:AdminAuthController){}
  clear():void{this.epoch++;this.pending.clear();}
  async call<T>(path:string,body?:unknown):Promise<T> {
    const epoch=this.epoch;
    const logical=path+'\n'+JSON.stringify(body);const post=body!==undefined;
    let key=this.pending.get(logical);
    if(post&&!key){key=crypto.randomUUID();this.pending.set(logical,key);}
    const response=await fetch(path,{method:post?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000),headers:post?{'content-type':'application/json','x-csrf-token':this.auth.sessionCsrf??'','idempotency-key':key!}:{},...(post?{body:JSON.stringify(body)}:{})});
    const envelope=await response.json() as {data?:T;error?:{code?:string}};
    if(epoch!==this.epoch)throw new Error('session changed');
    if(!response.ok||envelope.data===undefined){
      if(response.status===401)this.auth.sessionLost();
      if(post&&response.status>=400&&response.status<500&&!['IDEMPOTENCY_BUSY','IDEMPOTENCY_KEY_UNAVAILABLE'].includes(envelope.error?.code??''))this.pending.delete(logical);
      throw new BusinessApiError(envelope.error?.code??'UNKNOWN',response.status);
    }
    if(post)this.pending.delete(logical);
    return envelope.data;
  }
}
export function businessError(error:unknown):string {
  if(error instanceof BusinessApiError){
    if(error.status===403)return 'Tài khoản chưa được cấp quyền cho chức năng này.';
    if(error.code==='BANK_TRANSACTION_ALREADY_RECORDED')return 'Giao dịch này đã được ghi nhận. Hãy kiểm tra lịch sử trước khi xử lý tiếp.';
    if(error.code==='VERSION_CONFLICT'||error.code==='TOPUP_REQUEST_STATE_CONFLICT')return 'Yêu cầu đã thay đổi. Làm mới để xem kết quả mới nhất.';
    if(error.code==='BUSINESS_REQUEST_CLOSED')return 'Yêu cầu đã kết thúc. Lịch sử trao đổi vẫn được giữ lại.';
    if(error.code==='ADMIN_INPUT_INVALID')return 'Thông tin chưa hợp lệ. Kiểm tra số tiền, tài khoản và thời điểm giao dịch.';
    if(error.code==='BUSINESS_PUSH_NOT_CONFIGURED')return 'Chưa cấu hình thông báo đẩy. Danh sách chờ vẫn cập nhật bình thường.';
    if(error.status===429)return 'Thao tác hơi nhanh. Chờ một lát rồi thử lại.';
  }
  return 'Chưa xác định được kết quả. Kiểm tra kết nối và làm mới; nếu cần gửi lại, giữ nguyên thông tin.';
}

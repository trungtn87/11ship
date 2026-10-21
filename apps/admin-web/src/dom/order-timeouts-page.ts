import { ApiClient, ApiResult, record, fetchTransport } from '../core/api.js';
import { h, primary, secondary } from './dom.js';
const LABELS={confirmation_reminder:'Chờ quán: bắt đầu nhắc (phút)',confirmation_interval:'Chờ quán: nhắc lại mỗi (phút)',confirmation_cancel:'Chờ quán: tự hủy sau (phút)',search_stop:'Chờ shipper: dừng tìm / cảnh báo (phút)',search_cancel:'Chờ shipper: tự hủy đơn sau (phút)',pickup_warning:'Đã nhận: cảnh báo chưa lấy hàng sau (phút)',pickup_cancel:'Đã nhận: tự hủy khi chưa lấy hàng sau (phút)'};
type Parameters=Record<keyof typeof LABELS,number>;
interface Policy {version:number;parameters:Parameters;updated_at:string;effective:string;history:Record<string,unknown>[]}
function parse(data:Record<string,unknown>):Policy|undefined {
  const p=record(data.parameters);
  if(!p||typeof data.version!=='number'||typeof data.updated_at!=='string'||typeof data.effective!=='string'||!Array.isArray(data.history)||Object.keys(LABELS).some(k=>!Number.isSafeInteger(p[k])))return undefined;
  return data as unknown as Policy;
}
export class OrderTimeoutsApi extends ApiClient {
  read():Promise<ApiResult<Policy>>{return this.call({method:'GET',path:'/admin/system-settings/order-timeouts'},parse);}
  save(csrf:string,body:{expected_version:number;parameters:Parameters},key:string):Promise<ApiResult<Policy>>{
    return this.call({method:'POST',path:'/admin/system-settings/order-timeouts',csrf,idempotencyKey:key,body},parse);
  }
}
export function orderTimeoutsPage(root:HTMLElement,csrf:()=>string|undefined,onSessionLost:()=>void):void {
  const api=new OrderTimeoutsApi(fetchTransport(window.fetch.bind(window),{base:'/v1'}));
  const status=h('p',{role:'status',class:'hint'},'Đang tải…'),form=h('form',{class:'detail-block'}),history=h('div',{class:'detail-block'});
  root.replaceChildren(h('section',{class:'content content-narrow'},h('h1',{class:'title'},'Thời hạn xử lý đơn hàng & giao hàng'),status,form,history));
  let saved:Policy|undefined,intent:{body:{expected_version:number;parameters:Parameters};key:string}|undefined,busy=false;
  const errorOf=(r:ApiResult<Policy>):string=>{
    if(r.kind==='ok')return '';
    if(r.kind==='error'&&r.status===401)onSessionLost();
    if(r.kind==='error'&&r.status===403)return 'Bạn chưa được cấp quyền cài đặt thời hạn đơn hàng.';
    if(r.kind==='error'&&r.status===409)return 'Phiên bản đã thay đổi. Tải lại giá trị trước khi sửa.';
    return 'Chưa xác nhận được kết quả. Tải lại giá trị hiện tại hoặc bấm Lưu để thử lại đúng yêu cầu cũ.';
  };
  const draw=(p:Policy):void=>{
    saved=p;intent=undefined;
    const inputs=new Map<keyof Parameters,HTMLInputElement>();
    const rows=(Object.keys(LABELS) as (keyof Parameters)[]).map(k=>{
      const input=h('input',{type:'number',min:'1',max:'1440',step:'1',required:'',id:`timeout-${k}`,class:'input'});
      input.value=String(p.parameters[k]);inputs.set(k,input);input.addEventListener('input',()=>{intent=undefined;});
      return h('div',{class:'field'},h('label',{for:input.id},LABELS[k]),input);
    });
    const save=primary('Lưu thời hạn','submit'),reload=secondary('Tải lại giá trị');
    reload.addEventListener('click',()=>void load());
    form.replaceChildren(h('h2',{class:'subtitle'},'Đơn hàng & giao hàng'),h('p',{class:'hint'},p.effective),h('p',{class:'hint'},`Phiên bản ${p.version} · Có hiệu lực từ ${new Date(p.updated_at).toLocaleString('vi-VN')}. Sau lấy hàng không tự hủy. Nhắc shipper mỗi 5 phút vẫn giữ nguyên.`),...rows,h('div',{class:'detail-actions'},reload,save));
    form.onsubmit=e=>{
      e.preventDefault();if(busy||!saved||!form.reportValidity())return;
      const parameters=Object.fromEntries([...inputs].map(([k,i])=>[k,Number(i.value)])) as Parameters;
      if(parameters.confirmation_reminder>=parameters.confirmation_cancel||parameters.confirmation_interval>=parameters.confirmation_cancel||parameters.search_stop>parameters.search_cancel||parameters.pickup_warning>=parameters.pickup_cancel){status.textContent='Mốc nhắc phải trước mốc hủy; dừng tìm không được sau mốc hủy.';return;}
      intent??={body:{expected_version:saved.version,parameters},key:window.crypto.randomUUID()};
      const token=csrf();if(!token){onSessionLost();return;}
      busy=true;save.disabled=true;for(const i of inputs.values())i.disabled=true;
      void api.save(token,intent.body,intent.key).then(r=>{if(!form.isConnected)return;if(r.kind==='ok'){draw(r.data);status.textContent='Đã lưu. Áp dụng cho giai đoạn mới.';}else status.textContent=errorOf(r);}).finally(()=>{busy=false;save.disabled=false;for(const i of inputs.values())i.disabled=false;});
    };
    history.replaceChildren(h('h2',{class:'subtitle'},'Lịch sử thay đổi'),...p.history.map(r=>h('div',{class:'timeline-item'},h('p',{},`Phiên bản ${r.version} · ${new Date(String(r.created_at)).toLocaleString('vi-VN')} · ${r.actor_id}`),...Object.keys(LABELS).map(k=>h('p',{class:'hint'},`${LABELS[k as keyof Parameters]}: ${String(record(r.old_values)?.[k])} → ${String(record(r.new_values)?.[k])}`)))));
  };
  const load=async():Promise<void>=>{if(busy)return;status.textContent='Đang tải…';const r=await api.read();if(!form.isConnected)return;if(r.kind==='ok'){draw(r.data);status.textContent='';}else status.textContent=errorOf(r);};
  void load();
}

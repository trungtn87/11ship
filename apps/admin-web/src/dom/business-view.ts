import { AdminAuthController } from '../core/controller.js';
import { AdminRole } from '../core/api.js';
import { BusinessApi, BusinessApiError, businessError, BusinessReports, FinanceList, FinanceMessage, FinanceRequest, FinanceRoom, Notices, Report } from '../core/business-api.js';
import { ShellLayout } from './shell-layout.js';
import { ShellHost } from './view.js';
import { h, svg } from './dom.js';
const BASE='/v1/admin/business';
const stateText:Record<string,string>={PENDING:'Chờ kiểm tra',CONFIRMED:'Đã xác nhận',REJECTED:'Từ chối',CANCELLED:'Đã hủy'};
const tabs=[['overview','Tổng quan','◫'],['finance','Tài chính','₫'],['orders','Đơn hàng','▤'],['chat','Chat','◌'],['notifications','Thông báo','♧']] as const;
const time=(s:string)=>new Date(s).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'});
const money=(n:number)=>n.toLocaleString('vi-VN')+' đ';
function button(label:string,run:()=>void,kind=''):HTMLButtonElement{const b=h('button',{type:'button',class:'business-button '+kind},label);b.onclick=run;return b;}
function format(value:number|string|null|undefined,kind='count'):string {
  if(value===null||value===undefined)return '—';if(typeof value==='string')return value;
  return kind.includes('vnd')?money(value):kind==='percent'?value.toLocaleString('vi-VN')+'%':kind==='seconds'?value.toLocaleString('vi-VN')+' giây':value.toLocaleString('vi-VN');
}
export class BusinessDashboard implements ShellHost {
  private readonly api:BusinessApi;
  private host:HTMLElement|undefined;private content=h('main',{class:'business-content',tabindex:'-1'});private error=h('p',{class:'business-error',role:'alert',hidden:true});
  private updated=h('span',{class:'business-updated'});private badge=h('span',{class:'business-badge'});
  private timer:number|undefined;private generation=0;private mountEpoch=0;private busy=false;private canRecord=false;
  private range='today';private from='';private to='';private detailId:string|undefined;private pollRoom:(()=>Promise<void>)|undefined;
  private navButtons=new Map<string,HTMLButtonElement>();
  constructor(private readonly auth:AdminAuthController){this.api=new BusinessApi(auth);}
  mount({layout,role}:{layout:ShellLayout;role:AdminRole}):void {
    const epoch=++this.mountEpoch;this.busy=false;this.canRecord=false;
    this.host=layout.root;this.host.className='business-shell';
    const heading=h('div',{},h('p',{class:'business-eyebrow'},'11SHIP BUSINESS'),h('h1',{},'Điều hành kinh doanh'));
    const theme=button('Sáng / tối',()=>{const dark=this.host?.dataset.theme!=='dark';if(this.host)this.host.dataset.theme=dark?'dark':'light';try{localStorage.setItem('11business.theme',dark?'dark':'light');}catch{/* optional */}});
    try{this.host.dataset.theme=localStorage.getItem('11business.theme')??(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}catch{this.host.dataset.theme='light';}
    const logout=button('Đăng xuất',()=>void this.logout());
    const nav=h('nav',{class:'business-nav','aria-label':'Điều hướng chính'});
    this.navButtons.clear();for(const [name,label,icon]of tabs){const b=button('',()=>this.navigate(name));b.append(h('span',{'aria-hidden':'true'},icon),h('span',{},label));if(name==='notifications')b.append(this.badge);this.navButtons.set(name,b);nav.append(b);}
    this.host.replaceChildren(h('header',{class:'business-header'},heading,h('div',{class:'business-actions'},theme,logout)),h('div',{class:'business-status'},h('span',{},role==='SYSTEM'?'Tài khoản hệ thống':'Quản trị viên'),this.updated,button('Làm mới',()=>void this.refresh(true))),this.error,this.content,nav);
    window.addEventListener('popstate',this.pop);
    void this.api.call<{implicit:boolean;permissions:string[]}>('/v1/admin/finance/access/me').then(r=>{if(this.current(epoch))this.canRecord=r.implicit||r.permissions.includes('wallet.topup.record');}).catch(()=>undefined).finally(()=>{if(this.current(epoch))void this.refresh(true);});
    this.timer=window.setInterval(()=>void this.refresh(false),30000);
    void this.restorePush();
  }
  unmount():void{this.mountEpoch++;this.generation++;this.busy=false;this.canRecord=false;if(this.timer)clearInterval(this.timer);this.timer=undefined;window.removeEventListener('popstate',this.pop);this.clearSensitiveView();this.host=undefined;this.api.clear();this.pollRoom=undefined;}
  resume():void{void this.refresh(true);}
  clearSensitiveView():void{this.content.replaceChildren();this.detailId=undefined;this.pollRoom=undefined;}
  private readonly pop=()=>void this.refresh(true);
  private tab():string{return tabs.some(t=>t[0]===location.pathname.split('/')[2])?location.pathname.split('/')[2]!:'overview';}
  private navigate(tab:string,request?:string):void{history.pushState(null,'',`/business/${tab}${request?'?request='+encodeURIComponent(request):''}`);this.detailId=undefined;this.pollRoom=undefined;void this.refresh(true);}
  private current(epoch:number):boolean{return !!this.host&&epoch===this.mountEpoch;}
  private showError(e:unknown):void{if(!this.host)return;if(e instanceof BusinessApiError&&e.status===403)this.clearSensitiveView();this.error.hidden=false;this.error.textContent=businessError(e);}
  private async logout():Promise<void>{try{await this.api.call(BASE+'/push/unsubscribe',{});}catch{/* session-bound subscriptions also stop on server logout */}try{const r=await navigator.serviceWorker?.getRegistration('/business/');await(await r?.pushManager.getSubscription())?.unsubscribe();}catch{/* best effort cleanup of this browser endpoint */}await this.auth.logout();}
  private async refresh(force:boolean):Promise<void>{
    if(!this.host||this.busy||document.visibilityState==='hidden')return;
    const active=document.activeElement;
    if(!force&&(active instanceof HTMLInputElement||active instanceof HTMLTextAreaElement)&&!this.pollRoom)return;
    const epoch=this.mountEpoch;const target=location.pathname+location.search;
    this.busy=true;const gen=++this.generation;this.error.hidden=true;
    for(const [name,b]of this.navButtons){b.setAttribute('aria-current',name===this.tab()?'page':'false');}
    try{
      const tab=this.tab();
      if(tab==='overview')await this.overview();
      else if(tab==='finance'||tab==='chat'){
        const request=new URLSearchParams(location.search).get('request');
        if(request&&/^[0-9a-f-]{36}$/.test(request))await this.room(request,force);else await this.requests(tab==='finance');
      }else if(tab==='orders')await this.orders();else await this.notifications();
      if(this.host&&gen===this.generation)this.updated.textContent='Cập nhật '+new Date().toLocaleTimeString('vi-VN');
    }catch(e){if(this.current(epoch))this.showError(e);}finally{if(this.current(epoch))this.busy=false;}
    if(!this.current(epoch))return;
    if(this.host&&target!==location.pathname+location.search){void this.refresh(true);return;}
    if(this.host)void this.api.call<Notices>(BASE+'/notifications').then(n=>{if(this.current(epoch))this.badge.textContent=n.unread?String(n.unread):'';}).catch(()=>undefined);
  }
  private filters():HTMLElement{
    const select=h('select',{'aria-label':'Khoảng thời gian'});
    for(const [v,label]of [['today','Hôm nay'],['yesterday','Hôm qua'],['7d','7 ngày'],['month','Tháng này'],['custom','Chọn ngày']])select.append(h('option',{value:v},label));select.value=this.range;
    const from=h('input',{type:'date','aria-label':'Từ ngày',value:this.from});const to=h('input',{type:'date','aria-label':'Đến ngày',value:this.to});
    const apply=button('Xem',()=>{this.range=select.value;this.from=from.value;this.to=to.value;void this.refresh(true);});
    select.onchange=()=>{from.hidden=to.hidden=select.value!=='custom';if(select.value!=='custom'){this.range=select.value;void this.refresh(true);}};
    from.hidden=to.hidden=this.range!=='custom';return h('div',{class:'business-filters'},select,from,to,apply);
  }
  private query():string{const q=new URLSearchParams({range:this.range});if(this.range==='custom'){q.set('from',this.from);q.set('to',this.to);}return q.toString();}
  private tile(label:string,value:number|string|null|undefined,kind='count',previous?:number|string|null):HTMLElement {
    let delta='';if(typeof value==='number'&&typeof previous==='number')delta=previous===0?(value===0?'Không đổi':'Kỳ trước: 0'):`${value>=previous?'+':''}${((value-previous)/Math.abs(previous)*100).toLocaleString('vi-VN',{maximumFractionDigits:1})}% so với kỳ trước`;
    return h('article',{class:'business-tile'},h('p',{},label),h('strong',{},format(value,kind)),h('small',{},delta));
  }
  private reportPanel(r:Report,previous?:Report):HTMLElement{
    const grid=h('div',{class:'business-grid'});
    for(const s of r.summary){if(['goods'].includes(s.key))continue;const old=previous?.summary.find(p=>p.key===s.key)?.value;const tile=this.tile(s.label,s.value,s.format,old);if(s.note)tile.append(h('small',{},s.note));grid.append(tile);}
    const panel=h('section',{class:'business-panel'},h('h2',{},r.title.replace(' (delivery)','')),h('p',{class:'business-muted'},r.basisLabel),grid);
    if(r.rows.length){const table=h('table',{},h('thead',{},h('tr',{},...r.columns.map(c=>h('th',{scope:'col'},c.label)))));table.append(h('tbody',{},...r.rows.map(row=>h('tr',{},...row.cells.map((v,i)=>h('td',{},format(v,r.columns[i]?.format)))))));panel.append(h('div',{class:'business-table'},table));}
    if(r.truncated)panel.append(h('p',{},'Đang hiển thị 100 dòng đầu. Xem báo cáo đầy đủ trong Web Admin.'));return panel;
  }
  private async overview():Promise<void>{
    const epoch=this.mountEpoch;
    const d=await this.api.call<BusinessReports>(BASE+'/reports?'+this.query());if(!this.current(epoch))return;
    const t=d.trade;const old=d.previous_trade;
    const cards=h('div',{class:'business-grid'},this.tile('Giao dịch tạo mới',t.transactions,'count',old.transactions),this.tile('Giá trị tiền hàng',t.goods_vnd,'vnd',old.goods_vnd),this.tile('Tổng quán',t.shops),this.tile('Quán đã kích hoạt',t.active_shops),this.tile('Tổng shipper',t.shippers),this.tile('Shipper đang online',t.online_shippers));
    const sections=h('div',{},this.filters(),h('p',{class:'business-muted'},`${d.period.from_day} → ${d.period.to_day} · ${d.comparison_label}`),cards,h('p',{class:'business-muted'},t.goods_note));
    const delivery=d.reports.deliveries;if(delivery?.current){sections.append(this.chart(delivery.current));}
    const moneyReport=d.reports.money;if(moneyReport?.current){const s=moneyReport.current.summary;sections.append(h('div',{class:'business-grid'},...s.filter(x=>['commission','topup','balance','held'].includes(x.key)).map(x=>this.tile(x.label,x.value,x.format,moneyReport.previous?.summary.find(y=>y.key===x.key)?.value))));}
    const ranking=h('section',{class:'business-panel'},h('h2',{},'Quán có nhiều giao dịch'));
    for(const [i,r]of t.ranking.entries())ranking.append(h('div',{class:'business-ranking'},h('strong',{},`${i+1}. ${r.name}`),h('span',{},`${r.orders} giao dịch · ${money(r.goods_vnd)}`)));
    if(t.ranking_truncated)ranking.append(h('p',{class:'business-muted'},'Đang hiển thị 100 quán đầu. Xem báo cáo Web Admin để xem tiếp.'));
    if(!t.ranking.length)ranking.append(h('p',{},'Chưa có giao dịch trong kỳ.'));sections.append(ranking);
    sections.append(h('div',{class:'business-grid'},this.tile('Đánh giá',t.quality.reviews),this.tile('Điểm trung bình',t.quality.average_stars),this.tile('Khiếu nại trong kỳ',t.quality.complaints),this.tile('Xử lý khiếu nại trung bình',t.quality.average_resolution_seconds,'seconds')));
    for(const key of ['deliveries','shippers','quality']){const item=d.reports[key];if(item?.current){const details=h('details',{class:'business-details'},h('summary',{},item.current.title.replace(' (delivery)','')),this.reportPanel(item.current,item.previous));sections.append(details);}}
    sections.append(h('a',{href:'/reports'},'Mở báo cáo Web Admin'));
    this.content.replaceChildren(sections);
  }
  private chart(r:Report):HTMLElement {
    const max=Math.max(1,...r.rows.map(x=>Number(x.cells[1]??0)));
    const chart=svg('svg',{viewBox:'0 0 600 180',role:'img','aria-label':'Biểu đồ lượt giao theo ngày'});
    const width=560/Math.max(1,r.rows.length);
    r.rows.forEach((row,i)=>{const value=Number(row.cells[1]??0);const bar=svg('rect',{x:String(25+i*width),y:String(150-value/max*120),width:String(Math.max(2,width-4)),height:String(value/max*120),fill:'currentColor'});const title=svg('title',{});title.textContent=`${row.cells[0]}: ${value} lượt giao`;bar.append(title);chart.append(bar);});
    return h('section',{class:'business-panel business-chart'},h('h2',{},'Lượt giao theo ngày'),chart,h('p',{class:'business-muted'},'Mỗi cột là một ngày. Lượt giao tính riêng với giao dịch tạo mới.'));
  }
  private async requests(finance:boolean,before?:string,append=false):Promise<void>{
    const epoch=this.mountEpoch;
    this.detailId=undefined;this.pollRoom=undefined;
    const query=new URLSearchParams();if(finance)query.set('state','PENDING');if(before)query.set('before',before);
    const list=await this.api.call<FinanceList>(BASE+'/requests?'+query);if(!this.current(epoch))return;
    const panel=h('section',{class:'business-panel'},h('h2',{},finance?'Yêu cầu chờ kiểm tra':'Trao đổi tài chính'));
    if(finance){
      panel.append(h('p',{},'Chỉ xác nhận sau khi kiểm tra tiền thực nhận. Tin nhắn không thay thế sao kê.'),h('a',{href:'/finance/withdrawals'},'Xử lý rút ví'),h('a',{href:'/finance/reconciliation'},'Đối soát ví'));
      const d=await this.api.call<BusinessReports>(BASE+'/reports?'+this.query()).catch(error=>{if(error instanceof BusinessApiError&&error.status===403)return undefined;throw error;});
      if(!this.current(epoch))return;
      if(d?.reports.money?.current)panel.append(this.filters(),this.reportPanel(d.reports.money.current,d.reports.money.previous));
      if(d?.trade.shop_payments.status==='OK')panel.append(this.tile('Thanh toán quán đã xác nhận',d.trade.shop_payments.confirmed_vnd,'vnd'),h('p',{class:'business-muted'},'Ghi nhận tiền thực nhận theo ngày xác nhận. Không tạo ví hoặc tự mở tài khoản quán.'));
    }
    if(!list.items.length)panel.append(h('p',{},'Không có yêu cầu.'));
    for(const r of list.items)panel.append(this.requestCard(r));
    if(list.next_before)panel.append(button('Xem tiếp',()=>void this.requests(finance,list.next_before!,true).catch(e=>this.showError(e))));
    if(append)this.content.append(panel);else this.content.replaceChildren(panel);
  }
  private requestCard(r:FinanceRequest):HTMLElement{return button(`${r.label} · ${money(r.amount_requested_vnd)}\n${stateText[r.state]??r.state} · ${time(r.created_at)}${r.unread?' · '+r.unread+' chưa đọc':''}`,()=>this.navigate('chat',r.request_id),'business-request');}
  private async room(id:string,force:boolean):Promise<void>{
    const epoch=this.mountEpoch;
    if(this.detailId===id&&this.pollRoom&&!force){await this.pollRoom();return;}
    const room=await this.api.call<FinanceRoom>(BASE+'/requests/'+id);if(!this.current(epoch))return;this.detailId=id;
    const request=room.request;
    const messages=h('div',{class:'business-messages','aria-live':'polite'});
    const history=new Map<string,FinanceMessage>();
    const render=(r:FinanceRoom)=>{for(const m of r.messages.items)history.set(m.sequence,m);messages.replaceChildren(...[...history.values()].sort((a,b)=>BigInt(a.sequence)<BigInt(b.sequence)?-1:1).map(m=>h('article',{class:'business-message '+(m.role==='SYSTEM_EVENT'?'business-event':'')},h('small',{},`${({SYSTEM_EVENT:'Thông báo',SHIPPER:'Shipper',SHOP:'Quán',ADMIN:'Quản trị',SYSTEM:'Hệ thống'} as Record<string,string>)[m.role]??m.role} · ${time(m.created_at)}`),h('p',{},m.body))));};render(room);
    const panel=h('section',{class:'business-panel'},button('← Danh sách',()=>this.navigate('chat')),h('h2',{},request.label),h('p',{},`${money(request.amount_requested_vnd)} · ${stateText[request.state]??request.state}`),messages);
    if(request.kind==='TOPUP')panel.append(h('a',{href:'/finance/topups/'+request.request_id},'Xem hồ sơ nạp ví'));
    if(request.actual_amount_vnd!==null)panel.append(h('p',{},'Tiền thực nhận: '+money(request.actual_amount_vnd)));
    let olderCursor=room.messages.next_before;
    if(olderCursor){const older=button('Xem tin cũ hơn',()=>{if(!olderCursor)return;older.disabled=true;void this.api.call<FinanceRoom>(BASE+'/requests/'+id+'?before='+olderCursor).then(r=>{if(!this.current(epoch)||this.detailId!==id)return;render(r);olderCursor=r.messages.next_before;if(!olderCursor)older.remove();}).catch(e=>this.showError(e)).finally(()=>{older.disabled=false;});});panel.insertBefore(older,messages);}
    if(request.state==='PENDING'){
      const input=h('textarea',{'aria-label':'Tin nhắn',placeholder:'Nhập trao đổi…',maxlength:'1000',rows:'3',required:true});
      const send=h('button',{type:'submit',class:'business-button business-primary'},'Gửi tin nhắn');const form=h('form',{},input,send);
      form.onsubmit=e=>{e.preventDefault();if(!input.value.trim())return;send.disabled=true;void this.api.call(BASE+'/requests/'+id+'/messages',{body:input.value.trim()}).then(async()=>{input.value='';await update();}).catch(e=>this.showError(e)).finally(()=>{send.disabled=false;});};panel.append(form);
      if(this.canRecord)panel.append(await this.settlement(request));
    }else panel.append(h('p',{},'Yêu cầu đã kết thúc. Lịch sử trao đổi được giữ lại.'));
    const update=async()=>{const r=await this.api.call<FinanceRoom>(BASE+'/requests/'+id);if(!this.current(epoch)||this.detailId!==id)return;if(r.request.state!==request.state){this.detailId=undefined;this.pollRoom=undefined;await this.room(id,true);return;}render(r);await this.markRead(r);};
    if(!this.current(epoch))return;
    this.pollRoom=update;this.content.replaceChildren(panel);await this.markRead(room);
  }
  private async markRead(r:FinanceRoom):Promise<void>{const seq=r.messages.items.at(-1)?.sequence;if(seq)await this.api.call(BASE+'/requests/'+r.request.request_id+'/read',{sequence:seq});}
  private async settlement(r:FinanceRequest):Promise<HTMLElement>{
    const accounts=await this.api.call<{accounts:{account_id:string;bank_id:string;account_number_masked:string;can_receive:boolean}[]}>('/v1/admin/finance/topup-receiving-accounts');
    const box=h('details',{class:'business-details'},h('summary',{},'Kiểm tra và xử lý thanh toán'));
    const amount=h('input',{type:'number',inputmode:'numeric',min:'1',step:'1',required:true,value:String(r.amount_requested_vnd)});
    const account=h('select',{required:true});for(const a of accounts.accounts.filter(a=>a.can_receive))account.append(h('option',{value:a.account_id},`${a.bank_id} · ${a.account_number_masked}`));
    const transaction=h('input',{type:'text',maxlength:'128',required:true,autocomplete:'off'});
    const at=h('input',{type:'datetime-local',required:true});
    const submit=h('button',{type:'submit',class:'business-button business-primary'},'Xác nhận đã nhận tiền');
    const form=h('form',{},h('p',{},'Đối chiếu sao kê và nhập thông tin thực nhận. Thao tác này ghi nhận thanh toán.'),h('label',{},'Số tiền thực nhận (đ)',amount),h('label',{},'Tài khoản nhận',account),h('label',{},'Mã giao dịch trên sao kê',transaction),h('label',{},'Thời điểm giao dịch (giờ trên thiết bị)',at),submit);
    const base=r.kind==='TOPUP'?'/v1/admin/finance/topup-requests/'+r.request_id:BASE+'/requests/'+r.request_id;
    form.onsubmit=e=>{e.preventDefault();const a=accounts.accounts.find(x=>x.account_id===account.value);if(!a)return;submit.disabled=true;const body={expected_version:r.version,actual_amount_vnd:Number(amount.value),bank_id:a.bank_id,system_owned_account_id:a.account_id,canonical_transaction_id:transaction.value.trim(),received_at:new Date(at.value).toISOString()};void this.api.call(base+'/confirm',body).then(()=>{this.detailId=undefined;void this.refresh(true);}).catch(e=>this.showError(e)).finally(()=>{submit.disabled=false;});};
    const reason=h('select',{'aria-label':'Lý do từ chối'});for(const [v,t]of [['NOT_RECEIVED','Chưa nhận tiền'],['AMOUNT_MISMATCH','Số tiền chưa khớp'],['DUPLICATE_REQUEST','Yêu cầu trùng'],['INVALID_REQUEST','Thông tin chưa hợp lệ'],['OTHER','Cần trao đổi thêm']])reason.append(h('option',{value:v},t));
    const reject=button('Từ chối yêu cầu',()=>{reject.disabled=true;void this.api.call(base+'/reject',{expected_version:r.version,reason_code:reason.value}).then(()=>{this.detailId=undefined;void this.refresh(true);}).catch(e=>this.showError(e)).finally(()=>{reject.disabled=false;});},'business-danger');
    box.append(form,h('hr'),reason,reject);return box;
  }
  private async notifications(before?:string,append=false):Promise<void>{
    const epoch=this.mountEpoch;
    const d=await this.api.call<Notices>(BASE+'/notifications'+(before?'?before='+before:''));if(!this.current(epoch))return;
    const panel=h('section',{class:'business-panel'},h('h2',{},`Thông báo · ${d.unread} chưa đọc`),button('Bật thông báo đẩy',()=>void this.enablePush()),button('Tắt trên thiết bị này',()=>void this.disablePush()),h('p',{class:'business-muted'},'Thông báo trên màn hình khóa chỉ báo có cập nhật mới. Mở ứng dụng để xem chi tiết.'));
    for(const n of d.items){const label=({MESSAGE:'Có tin nhắn mới',CREATED:'Có yêu cầu mới',STATE:'Yêu cầu đổi trạng thái',OVERDUE:'Yêu cầu chờ quá lâu'} as Record<string,string>)[n.kind]??'Có cập nhật';panel.append(button(`${n.unread?'● ':''}${label} · ${time(n.created_at)}`,()=>this.navigate('chat',n.request_id),'business-request'));}
    if(!d.items.length)panel.append(h('p',{},'Chưa có thông báo.'));if(d.next_before)panel.append(button('Xem tiếp',()=>void this.notifications(d.next_before!,true).catch(e=>this.showError(e))));
    if(append)this.content.append(panel);else this.content.replaceChildren(panel);
  }
  private async orders(offset=0,append=false):Promise<void>{
    const epoch=this.mountEpoch;
    const d=await this.api.call<{items:{order_id:string;display_code?:string;shop_name:string;items_total_vnd:number;display_status?:string;status:string}[];total:number}>('/v1/admin/orders?limit=20&offset='+offset);if(!this.current(epoch))return;
    const panel=h('section',{class:'business-panel'},h('h2',{},`Đơn món · ${d.total}`),h('p',{class:'business-muted'},'Đơn món tính riêng với các lượt tìm shipper.'));
    for(const o of d.items)panel.append(button(`${o.shop_name} · ${money(o.items_total_vnd)}\n${o.display_status??o.status}`,()=>void this.orderDetail(o.order_id).catch(e=>this.showError(e)),'business-request'));
    if(offset+20<d.total)panel.append(button('Xem tiếp',()=>void this.orders(offset+20,true).catch(e=>this.showError(e))));if(append)this.content.append(panel);else this.content.replaceChildren(panel);
  }
  private async orderDetail(id:string):Promise<void>{
    const epoch=this.mountEpoch;
    const d=await this.api.call<{shop:{name:string};recipient:{name:string;address_text:string};money:{items_total_vnd:number;fee:{amount_vnd:number|null}};display_status:string;created_at:string;items:{name:string;quantity:number;unit_price_vnd:number}[]}>('/v1/admin/orders/'+id);if(!this.current(epoch))return;
    const panel=h('section',{class:'business-panel'},button('← Đơn hàng',()=>void this.orders()),h('h2',{},'Chi tiết đơn hàng'));
    panel.append(h('p',{},d.shop.name),h('p',{},d.display_status),h('p',{},d.recipient.name+' · '+d.recipient.address_text),h('p',{},'Tiền hàng: '+money(d.money.items_total_vnd)),h('p',{},'Phí vận chuyển: '+format(d.money.fee.amount_vnd,'vnd')),h('p',{},time(d.created_at)));
    for(const item of d.items)panel.append(h('p',{},`${item.quantity} × ${item.name} · ${money(item.unit_price_vnd)}`));
    panel.append(h('a',{href:'/operations/orders'},'Mở quản lý đơn hàng trong Web Admin'));this.content.replaceChildren(panel);
  }
  private async registerWorker():Promise<ServiceWorkerRegistration|undefined>{if(!('serviceWorker'in navigator)||!window.isSecureContext)return;return navigator.serviceWorker.register('/business-sw.js',{scope:'/business/'}).catch(()=>undefined);}
  private async restorePush():Promise<void>{
    try {const registration=await this.registerWorker();if(!registration||!('Notification'in window)||Notification.permission!=='granted')return;
      const sub=await registration.pushManager.getSubscription();if(sub){const j=sub.toJSON();await this.api.call(BASE+'/push/subscribe',{endpoint:j.endpoint,keys:j.keys});}
    }catch{/* Inbox remains authoritative when a provider or configuration is unavailable. */}
  }
  private async enablePush():Promise<void>{
    try{
      if(!('Notification'in window)||!('PushManager'in window))throw new Error('unsupported');
      const permission=await Notification.requestPermission();if(permission!=='granted'){this.error.hidden=false;this.error.textContent='Chưa bật thông báo. Bạn vẫn xem được mọi yêu cầu trong danh sách chờ.';return;}
      const settings=await this.api.call<{configured:boolean;public_key:string|null}>(BASE+'/push');if(!settings.configured||!settings.public_key){this.error.hidden=false;this.error.textContent='Chưa cấu hình thông báo đẩy. Danh sách chờ vẫn hoạt động.';return;}
      await this.registerWorker();const registration=await navigator.serviceWorker.ready;
      const key=Uint8Array.from(atob(settings.public_key.replaceAll('-','+').replaceAll('_','/')),x=>x.charCodeAt(0));
      const s=await registration.pushManager.getSubscription()??await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
      const j=s.toJSON();await this.api.call(BASE+'/push/subscribe',{endpoint:j.endpoint,keys:j.keys});this.error.hidden=false;this.error.textContent='Đã bật thông báo trên thiết bị này.';
    }catch(e){this.showError(e);}
  }
  private async disablePush():Promise<void>{try{await this.api.call(BASE+'/push/unsubscribe',{});const r=await this.registerWorker();await(await r?.pushManager.getSubscription())?.unsubscribe();this.error.hidden=false;this.error.textContent='Đã tắt thông báo trên thiết bị này.';}catch(e){this.showError(e);}}
}

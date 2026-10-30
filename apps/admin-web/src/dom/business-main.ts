import { AdminAuthApi, fetchTransport } from '../core/api.js';
import { AdminAuthController, Clock } from '../core/controller.js';
import { AdminView } from './view.js';
import { BusinessDashboard } from './business-view.js';
import { startReset } from './reset-start.js';
const clock:Clock={now:()=>Date.now(),setTimeout:(f,ms)=>window.setTimeout(f,ms),clearTimeout:h=>window.clearTimeout(h as number)};
function deviceId():string {
  try {const old=localStorage.getItem('11admin.device_id');if(old&&/^web-[0-9a-f]{32}$/.test(old))return old;}catch{/* blocked storage */}
  const id='web-'+crypto.randomUUID().replaceAll('-','');try{localStorage.setItem('11admin.device_id',id);}catch{/* ephemeral label */}return id;
}
if((location.pathname==='/business'||location.pathname==='/business.html'))history.replaceState(null,'','/business/'+location.search);
const root=document.getElementById('app');
// Forgot password inside the installed PWA (issue #235): a page UNDER /business/ so a standalone window keeps it in scope and returns to /business/.
const resetPage=location.pathname.replace(/\/+$/,'')==='/business/reset';
if(root&&resetPage){
  startReset(root,'/business/');
}else if(root){
  const auth=new AdminAuthController(new AdminAuthApi(fetchTransport(window.fetch.bind(window))),clock,deviceId);
  const dashboard=new BusinessDashboard(auth);
  const view=new AdminView(root,auth,dashboard,'/business/reset');
  auth.subscribe(s=>view.render(s));view.render(auth.screen);void auth.start();
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void auth.recheck();});
  window.addEventListener('pageshow',()=>{if(auth.screen.name==='shell'){void auth.recheck();dashboard.resume();}});
  window.addEventListener('pagehide',()=>dashboard.clearSensitiveView());
}

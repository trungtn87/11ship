import { AdminAuthApi, fetchTransport } from '../core/api.js';
import { AdminAuthController, Clock } from '../core/controller.js';
import { AdminView } from './view.js';
import { BusinessDashboard } from './business-view.js';
const clock:Clock={now:()=>Date.now(),setTimeout:(f,ms)=>window.setTimeout(f,ms),clearTimeout:h=>window.clearTimeout(h as number)};
function deviceId():string {
  try {const old=localStorage.getItem('11admin.device_id');if(old&&/^web-[0-9a-f]{32}$/.test(old))return old;}catch{/* blocked storage */}
  const id='web-'+crypto.randomUUID().replaceAll('-','');try{localStorage.setItem('11admin.device_id',id);}catch{/* ephemeral label */}return id;
}
const root=document.getElementById('app');
if(root){
  const auth=new AdminAuthController(new AdminAuthApi(fetchTransport(window.fetch.bind(window))),clock,deviceId);
  const dashboard=new BusinessDashboard(auth);
  const view=new AdminView(root,auth,dashboard);
  auth.subscribe(s=>view.render(s));view.render(auth.screen);void auth.start();
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void auth.recheck();});
  window.addEventListener('pageshow',()=>{if(auth.screen.name==='shell'){void auth.recheck();dashboard.resume();}});
  window.addEventListener('pagehide',()=>dashboard.clearSensitiveView());
}

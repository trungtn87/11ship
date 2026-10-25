/* No fetch handler, CacheStorage, IndexedDB or offline copies: every view requires a live session and API. */
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  let url='/business/notifications';
  try {const value=event.data.json();if(typeof value.url==='string'&&/^\/business\/chat\?request=[0-9a-f-]{36}$/.test(value.url))url=value.url;} catch { /* fixed neutral notice */ }
  event.waitUntil(self.registration.showNotification('11Ship',{body:'Có cập nhật mới cần kiểm tra.',icon:'/business-icon-192.png',tag:'11ship-business',data:{url}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=new URL(event.notification.data?.url||'/business/notifications',self.location.origin);
  if(url.origin!==self.location.origin||!url.pathname.startsWith('/business/'))return;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
    const existing=clients.find(client=>new URL(client.url).pathname.startsWith('/business/'));
    if(existing){await existing.navigate(url.href);return existing.focus();}
    return self.clients.openWindow(url.href);
  }));
});

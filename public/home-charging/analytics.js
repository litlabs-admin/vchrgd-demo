(() => {
  'use strict';
  const KEY='vchrgd_site_statistics_off',control=document.querySelector('#statistics-toggle'),status=document.querySelector('#statistics-status');
  const privacy=()=>navigator.globalPrivacyControl===true||navigator.doNotTrack==='1';
  const read=key=>{try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}};
  const save=value=>{try{localStorage.setItem(KEY,JSON.stringify({off:value,expires:Date.now()+180*86400000}));}catch{}};
  // Preserve an earlier refusal, then retire the old visitor/session identifiers.
  const old=read('vchrgd_analytics_choice_v1');if(old?.value==='deny'&&old.expires>Date.now())save(true);
  try{localStorage.removeItem('vchrgd_landing_visitor_v1');localStorage.removeItem('vchrgd_analytics_choice_v1');sessionStorage.removeItem('vchrgd_landing_session_v1');}catch{}
  const off=()=>{const p=read(KEY);return privacy()||Boolean(p?.off&&p.expires>Date.now());};
  const pageId=crypto.randomUUID();let engaged=false,viewSent=false,visibleMs=0,visibleSince=document.visibilityState==='visible'?performance.now():null;
  function send(event){try{if(off())return;void fetch('/api/landing-analytics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event,pageId,eventId:crypto.randomUUID()}),credentials:'omit',keepalive:true,referrerPolicy:'no-referrer'}).catch(()=>{});}catch{}}
  function view(){if(!viewSent&&!off()){viewSent=true;send('page_view');}}
  function engage(){if(!engaged&&!off()){engaged=true;send('page_engaged');}}
  function action(event){if(off())return;engage();send(event);}
  function updateControl(){if(control){control.textContent=off()?'Turn on statistics':'Turn off statistics';control.disabled=privacy();}if(status)status.textContent=privacy()?'Disabled by your browser privacy setting.':off()?'Statistics are off for this browser.':'Anonymous statistics are on.';}
  control?.addEventListener('click',()=>{save(!off());updateControl();view();});
  window.addEventListener('storage',event=>{if(event.key===KEY){updateControl();view();}});
  function checkTime(){if(!engaged&&visibleMs+(visibleSince===null?0:performance.now()-visibleSince)>=10000)engage();}
  document.addEventListener('visibilitychange',()=>{if(visibleSince!==null)visibleMs+=Math.max(0,performance.now()-visibleSince);visibleSince=document.visibilityState==='visible'?performance.now():null;checkTime();});
  const timer=setInterval(()=>{checkTime();if(engaged)clearInterval(timer);},1000);
  window.addEventListener('pagehide',()=>{checkTime();clearInterval(timer);});
  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;if(!target)return;const a=target.closest('a');
    if(a?.classList.contains('checkout')){const section=a.closest('.hero-actions')?'hero':a.closest('.header')?'header':a.closest('#seven-pro')?'product':a.closest('#payment')?'frasers':a.closest('#card-payment')?'card':a.closest('.closing')?'closing':a.closest('.mobile-cta')?'mobile':null;if(section)action('checkout_'+section);}
    const model=target.closest('[data-model]')?.dataset.model;if(model==='tethered'||model==='untethered')action('product_'+model);
    if(a){try{const u=new URL(a.href);if(u.origin===location.origin&&u.hash==='#payment')action('frasers_explore');if(u.hostname==='l.ead.me')action('guide_click');if(u.hostname==='frasersplus.com'||u.hostname==='fgsupporthelp.zendesk.com')action('frasers_info_click');if(u.hostname==='octopus.energy')action('octopus_click');}catch{}}
  },{capture:true});
  document.querySelectorAll('.faq-list details').forEach(d=>d.addEventListener('toggle',()=>{if(d.open)action('faq_open');}));
  document.querySelector('.sp-spec-toggle')?.addEventListener('click',e=>{if(e.currentTarget.getAttribute('aria-expanded')==='true')action('technical_open');});
  updateControl();view();
})();

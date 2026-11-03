const menu = document.querySelector('.menu');
const navigation = document.querySelector('#navigation');
function closeMenu(){menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','Open navigation');navigation.classList.remove('open');}
menu.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'Close navigation':'Open navigation');navigation.classList.toggle('open',open);});
navigation.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMenu));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu.getAttribute('aria-expanded')==='true'){closeMenu();menu.focus();}});

const models={tethered:{kind:'Tethered',heading:'7.5m Type 2 cable.',description:'Convenient home charging with an integrated cable. Just park, plug in and charge.',price:'£935',alt:'Seven Pro tethered charger with its integrated Type 2 cable'},untethered:{kind:'Untethered',heading:'Type 2 socket. Compact design.',description:'A compact home charging solution with an optional cable-lock setting, so you can keep your cable stored in the charger between charges.',price:'£895',alt:'Seven Pro untethered charger with a Type 2 socket'}};
const spReduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const modelButtons=[...document.querySelectorAll('[data-model]')];
function selectModel(button){
 const model=button.dataset.model,content=models[model];
 if(button.getAttribute('aria-pressed')==='true')return;
 modelButtons.forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
 button.closest('.sp-switch')?.style.setProperty('--i',String(modelButtons.indexOf(button)));
 document.querySelectorAll('[data-model-img]').forEach(img=>{const on=img.dataset.modelImg===model;img.classList.toggle('is-active',on);img.alt=on?content.alt:'';img.toggleAttribute('aria-hidden',!on);});
 const panel=document.querySelector('.sp-model');
 const swap=()=>{document.querySelector('#model-kind').textContent=content.kind;document.querySelector('#model-heading').textContent=content.heading;document.querySelector('#model-description').textContent=content.description;document.querySelector('#model-price').textContent=content.price;panel?.classList.remove('is-swapping');};
 if(panel&&!spReduce){panel.classList.add('is-swapping');setTimeout(swap,180);}else swap();
}
modelButtons.forEach((button,i)=>{
 button.addEventListener('click',()=>selectModel(button));
 button.addEventListener('keydown',e=>{if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;e.preventDefault();const next=modelButtons[(i+(e.key==='ArrowRight'?1:-1)+modelButtons.length)%modelButtons.length];next.focus();selectModel(next);});
});

// Seven Pro features: one active at a time.
// Auto-advances (progress line animation end) while the section is in view, unless reduced motion is on.
const sp=document.querySelector('.sp');
const features=[...document.querySelectorAll('.sp-feature')];
function selectFeature(index){
 features.forEach((f,i)=>f.setAttribute('aria-pressed',String(i===index)));
 // restart the progress animation on the new active row
 const bar=features[index]?.querySelector('.sp-f-progress');if(bar){bar.style.animation='none';void bar.offsetWidth;bar.style.animation='';}
}
features.forEach((f,i)=>{
 f.addEventListener('click',()=>selectFeature(i));
 f.querySelector('.sp-f-progress')?.addEventListener('animationend',()=>selectFeature((i+1)%features.length));
});
if(sp&&!spReduce&&'IntersectionObserver' in window){
 const featureBox=document.querySelector('.sp-features');
 const pause=on=>sp.classList.toggle('is-paused',on);
 new IntersectionObserver(([entry])=>{sp.classList.toggle('is-cycling',true);pause(!entry.isIntersecting);},{threshold:.35}).observe(sp);
 featureBox.addEventListener('pointerenter',()=>pause(true));featureBox.addEventListener('pointerleave',()=>pause(false));
 featureBox.addEventListener('focusin',()=>pause(true));featureBox.addEventListener('focusout',()=>pause(false));
}

// Technical details: animated disclosure.
const specToggle=document.querySelector('.sp-spec-toggle'),specPanel=document.querySelector('#sp-spec-panel');
specToggle?.addEventListener('click',()=>{const open=specToggle.getAttribute('aria-expanded')!=='true';specToggle.setAttribute('aria-expanded',String(open));specPanel.classList.toggle('is-open',open);});

// Stage depth: slow scroll parallax on the product.
const product=document.querySelector('.sp-product');
if(sp&&product&&!spReduce){
 let visible=false,ticking=false;
 const parallax=()=>{ticking=false;const r=sp.getBoundingClientRect(),progress=(r.top+r.height/2-innerHeight/2)/innerHeight;product.style.setProperty('--py',`${Math.max(-1,Math.min(1,progress))*30}px`);};
 new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;if(visible)parallax();}).observe(sp);
 window.addEventListener('scroll',()=>{if(visible&&!ticking){ticking=true;requestAnimationFrame(parallax);}},{passive:true});
}
// App section: one feature open at a time. Rotates every 4.5s (progress line end), starting once the section is in view.
const apSection=document.querySelector('.ap'),apItems=[...document.querySelectorAll('.ap-item')];
function selectApItem(index){
 apItems.forEach((item,i)=>item.setAttribute('aria-expanded',String(i===index)));
 const bar=apItems[index]?.querySelector('.ap-progress');if(bar){bar.style.animation='none';void bar.offsetWidth;bar.style.animation='';}
}
apItems.forEach((item,i)=>{
 item.addEventListener('click',()=>selectApItem(i));
 item.querySelector('.ap-progress')?.addEventListener('animationend',()=>selectApItem((i+1)%apItems.length));
});
if(apSection&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches&&'IntersectionObserver' in window){
 const apList=document.querySelector('.ap-list');let started=false;
 const pause=on=>apSection.classList.toggle('is-paused',on);
 new IntersectionObserver(([entry])=>{
  if(entry.isIntersecting&&!started){started=true;selectApItem(0);apSection.classList.add('is-cycling');}
  pause(!entry.isIntersecting);
 },{threshold:.4}).observe(apSection);
 apList.addEventListener('pointerenter',()=>pause(true));apList.addEventListener('pointerleave',()=>pause(false));
 apList.addEventListener('focusin',()=>pause(true));apList.addEventListener('focusout',()=>pause(false));
}

const energy=document.querySelector('#energy'),standard=document.querySelector('#standard-rate'),offpeak=document.querySelector('#offpeak-rate');
const money=new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'});
function calculate(){
 document.querySelector('#energy-output').value=`${energy.value} kWh`;
 const valid=standard.value!==''&&offpeak.value!==''&&standard.validity.valid&&offpeak.validity.valid;
 if(!valid){document.querySelector('#standard-cost').textContent='—';document.querySelector('#offpeak-cost').textContent='—';document.querySelector('#difference').textContent='Enter rates between 0 and 200 p/kWh to compare.';return;}
 const amount=Number(energy.value),s=amount*Number(standard.value)/100,o=amount*Number(offpeak.value)/100,max=Math.max(s,o);
 document.querySelector('#standard-cost').textContent=money.format(s);document.querySelector('#offpeak-cost').textContent=money.format(o);
 document.querySelector('#standard-bar').style.width=`${max?s/max*100:0}%`;document.querySelector('#offpeak-bar').style.width=`${max?o/max*100:0}%`;
 const difference=s-o;document.querySelector('#difference').textContent=Math.abs(difference)<.005?'The same energy cost at these rates':`${money.format(Math.abs(difference))} ${difference>0?'less':'more'} for this charge at the off-peak rate`;
}
[energy,standard,offpeak].forEach(input=>input.addEventListener('input',calculate));
document.querySelector('#reset-calculator').addEventListener('click',()=>{energy.value=60;standard.value=26.11;offpeak.value=7.5;calculate();});calculate();
const sticky=document.querySelector('.mobile-cta');
const observer=new IntersectionObserver(([entry])=>sticky.classList.toggle('show',!entry.isIntersecting),{threshold:0});observer.observe(document.querySelector('.hero'));

// All CTAs begin at the existing charger-selection page. No product or payment plan is preselected.
// Carry only marketing attribution; never forward checkout or payment identifiers.
const incoming=new URLSearchParams(location.search);
document.querySelectorAll('a.checkout').forEach(link=>{
 const target=new URL(link.href);target.searchParams.set('utm_source','vchrgd');target.searchParams.set('utm_medium','landing-page');target.searchParams.set('utm_campaign','home-charging-frasers-plus');
 for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']){const value=incoming.get(key);if(value&&value.length<=180)target.searchParams.set(key,value);}
 link.href=target.toString();
});

// Navbar sits transparently over the hero, then turns solid once the page scrolls.
const header=document.querySelector('.header');
const syncHeader=()=>header.classList.toggle('scrolled',window.scrollY>8);
syncHeader();window.addEventListener('scroll',syncHeader,{passive:true});

// Scroll reveal: fade sections in once as they enter view. Reduced-motion users see everything immediately (CSS gates the effect).
const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const revealItems=document.querySelectorAll('[data-reveal]');
const reveal=el=>{el.classList.add('in');setTimeout(()=>el.removeAttribute('data-reveal'),1200);};
if('IntersectionObserver' in window&&!reduceMotion){
 const revealObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){reveal(entry.target);revealObserver.unobserve(entry.target);}}),{threshold:.15,rootMargin:'0px 0px -40px 0px'});
 revealItems.forEach(el=>revealObserver.observe(el));
}else revealItems.forEach(reveal);

// Count the numeric stats up once when they come into view.
const counters=document.querySelectorAll('[data-count]');
if('IntersectionObserver' in window&&!reduceMotion&&counters.length){
 const countObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{
  if(!entry.isIntersecting)return;countObserver.unobserve(entry.target);
  const el=entry.target,target=Number(el.dataset.count),decimals=Number(el.dataset.decimals||0),start=performance.now(),duration=1100;
  const tick=now=>{const t=Math.min((now-start)/duration,1),eased=1-Math.pow(1-t,3);el.textContent=(target*eased).toFixed(decimals);if(t<1)requestAnimationFrame(tick);};
  el.textContent=(0).toFixed(decimals);requestAnimationFrame(tick);
 }),{threshold:.6});
 counters.forEach(el=>countObserver.observe(el));
}

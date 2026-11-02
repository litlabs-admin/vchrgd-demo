const menu = document.querySelector('.menu');
const navigation = document.querySelector('#navigation');
function closeMenu(){menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','Open navigation');navigation.classList.remove('open');}
menu.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'Close navigation':'Open navigation');navigation.classList.toggle('open',open);});
navigation.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMenu));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu.getAttribute('aria-expanded')==='true'){closeMenu();menu.focus();}});

const models={tethered:{heading:'7.5m Type 2 cable.',description:'Convenient home charging with an integrated cable. Just park, plug in and charge.',price:'Installed from £935',alt:'Seven Pro tethered charger with its integrated Type 2 cable'},untethered:{heading:'Type 2 socket. Compact design.',description:'A compact home charging solution with an optional cable-lock setting, so you can keep your cable stored in the charger between charges.',price:'Installed from £895',alt:'Seven Pro untethered charger with a Type 2 socket'}};
document.querySelectorAll('[data-model]').forEach(button=>button.addEventListener('click',()=>{
 const model=button.dataset.model;const content=models[model];
 document.querySelectorAll('[data-model]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
 document.querySelector('#model-heading').textContent=content.heading;document.querySelector('#model-description').textContent=content.description;
 document.querySelector('#model-price').textContent=content.price;
 const image=document.querySelector('#product-image');image.src=`/home-charging/assets/${model}.webp`;image.alt=content.alt;
}));
document.querySelectorAll('.app-feature').forEach(button=>button.addEventListener('click',()=>{
 const expand=button.getAttribute('aria-expanded')!=='true';
 document.querySelectorAll('.app-feature').forEach(b=>{b.setAttribute('aria-expanded','false');b.classList.remove('active');b.querySelector('p').hidden=true;b.querySelector('b').textContent='+';});
 if(expand){button.setAttribute('aria-expanded','true');button.classList.add('active');button.querySelector('p').hidden=false;button.querySelector('b').textContent='−';}
}));

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

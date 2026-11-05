// VCHRGD homepage behaviour — mirrors the home-charging page patterns.
const menu = document.querySelector('.menu');
const navigation = document.querySelector('#navigation');
function closeMenu() {
  menu.setAttribute('aria-expanded', 'false');
  menu.setAttribute('aria-label', 'Open navigation');
  navigation.classList.remove('open');
}
if (menu && navigation) {
  menu.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    navigation.classList.toggle('open', open);
  });
  navigation.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      menu.focus();
    }
  });
}

// Reliable in-page anchor scrolling. Native hash jumps can overshoot while the
// page's reveal animations / lazy media are still settling, so we compute the
// target position at click time and account for the sticky header.
const HEADER_OFFSET = 76;
function scrollToHash(hash, smooth) {
  const el = document.querySelector(hash);
  if (!el) return false;
  const y = el.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET;
  window.scrollTo({ top: Math.max(0, y), behavior: smooth ? "smooth" : "auto" });
  return true;
}
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  const hash = a.getAttribute("href");
  if (!hash || hash.length < 2) return; // ignore bare "#"
  a.addEventListener("click", (e) => {
    if (!document.querySelector(hash)) return; // let it behave normally if no target
    e.preventDefault();
    if (history.pushState) history.pushState(null, "", hash);
    scrollToHash(hash, true);
  });
});
// Honour a hash already in the URL on load, once layout has settled.
if (location.hash.length > 1) {
  window.addEventListener("load", () => setTimeout(() => scrollToHash(location.hash, false), 120));
}

const header = document.querySelector('.header');
if (header) {
  const syncHeader = () => header.classList.toggle('scrolled', window.scrollY > 8);
  syncHeader();
  window.addEventListener('scroll', syncHeader, { passive: true });
}

// Carry marketing attribution onto every checkout/home-charging link. Never forward
// checkout or payment identifiers.
const incoming = new URLSearchParams(location.search);
document.querySelectorAll('a.checkout').forEach(link => {
  const target = new URL(link.href, location.origin);
  target.searchParams.set('utm_source', 'vchrgd');
  target.searchParams.set('utm_medium', 'homepage');
  target.searchParams.set('utm_campaign', 'homepage-home-charging');
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    const value = incoming.get(key);
    if (value && value.length <= 180) target.searchParams.set(key, value);
  }
  link.href = target.toString();
});

// Scroll reveal: fade sections in once as they enter view.
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const revealItems = document.querySelectorAll('[data-reveal]');
const reveal = el => {
  el.classList.add('in');
  setTimeout(() => el.removeAttribute('data-reveal'), 1200);
};
if ('IntersectionObserver' in window && !reduceMotion) {
  const revealObserver = new IntersectionObserver(
    entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        reveal(entry.target);
        revealObserver.unobserve(entry.target);
      }
    }),
    { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
  );
  revealItems.forEach(el => revealObserver.observe(el));
} else {
  revealItems.forEach(reveal);
}

// Count numeric stats up once when they come into view.
const counters = document.querySelectorAll('[data-count]');
if ('IntersectionObserver' in window && !reduceMotion && counters.length) {
  const countObserver = new IntersectionObserver(
    entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      countObserver.unobserve(entry.target);
      const el = entry.target;
      const targetVal = Number(el.dataset.count);
      const decimals = Number(el.dataset.decimals || 0);
      const start = performance.now();
      const duration = 1100;
      const tick = now => {
        const t = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = (targetVal * eased).toFixed(decimals);
        if (t < 1) requestAnimationFrame(tick);
      };
      el.textContent = (0).toFixed(decimals);
      requestAnimationFrame(tick);
    }),
    { threshold: 0.6 },
  );
  counters.forEach(el => countObserver.observe(el));
}

// EV tariff calculator: live savings estimate.
(function () {
  const battery = document.getElementById("calc-battery");
  const miles = document.getElementById("calc-miles");
  const eff = document.getElementById("calc-eff");
  const tariff = document.getElementById("calc-tariff");
  if (!battery || !miles || !eff || !tariff) return;

  const STANDARD_RATE = 25.72; // p/kWh single rate (USwitch 08/2025)
  const CHARGER_KW = 7; // Seven Pro
  const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
  const el = (id) => document.getElementById(id);

  function pulse(node) {
    if (!node) return;
    node.classList.remove("calc-value-pulse");
    void node.offsetWidth;
    node.classList.add("calc-value-pulse");
  }

  function calc() {
    const batt = Number(battery.value);
    const annualMiles = Number(miles.value);
    const milesPerKwh = Number(eff.value);
    const offPeak = Number(tariff.value);

    el("calc-battery-out").value = batt + " kWh";
    el("calc-miles-out").value = annualMiles.toLocaleString("en-GB") + " miles";
    el("calc-eff-out").value = milesPerKwh.toFixed(1);

    const annualKwh = annualMiles / milesPerKwh;
    const weeklyKwh = annualKwh / 52;
    const hours = weeklyKwh / CHARGER_KW;
    const weeklyCost = (weeklyKwh * offPeak) / 100;
    const savings = Math.max(0, (annualKwh * (STANDARD_RATE - offPeak)) / 100);

    const hoursEl = el("calc-hours");
    const weeklyEl = el("calc-weekly");
    const savingsEl = el("calc-savings");
    hoursEl.textContent = hours.toFixed(1) + " hours";
    weeklyEl.textContent = money.format(weeklyCost);
    savingsEl.textContent = money.format(savings);
    pulse(hoursEl);
    pulse(weeklyEl);
    pulse(savingsEl);
  }

  [battery, miles, eff, tariff].forEach((input) =>
    input.addEventListener("input", calc),
  );
  calc();
})();

// Mobile sticky CTA appears once the hero scrolls away.
const sticky = document.querySelector('.mobile-cta');
const hero = document.querySelector('.hero');
if (sticky && hero && 'IntersectionObserver' in window) {
  new IntersectionObserver(
    ([entry]) => sticky.classList.toggle('show', !entry.isIntersecting),
    { threshold: 0 },
  ).observe(hero);
}

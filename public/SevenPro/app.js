/* Seven Pro page interactivity — defensive (every lookup is null-guarded)
   so missing sections never break the page. Built on the same design
   system as /home-charging. */
(function () {
  "use strict";
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Mobile navigation ---------- */
  var menu = document.querySelector(".menu");
  var navigation = document.querySelector("#navigation");
  if (menu && navigation) {
    var closeMenu = function () {
      menu.setAttribute("aria-expanded", "false");
      menu.setAttribute("aria-label", "Open navigation");
      navigation.classList.remove("open");
    };
    menu.addEventListener("click", function () {
      var open = menu.getAttribute("aria-expanded") !== "true";
      menu.setAttribute("aria-expanded", String(open));
      menu.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
      navigation.classList.toggle("open", open);
    });
    navigation.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", closeMenu);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menu.getAttribute("aria-expanded") === "true") {
        closeMenu();
        menu.focus();
      }
    });
  }

  /* ---------- Overview triad (Smart / Safe / Secure) ---------- */
  var triadButtons = Array.prototype.slice.call(
    document.querySelectorAll(".triad-q")
  );
  triadButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var isOpen = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!isOpen));
    });
  });

  /* ---------- Model switch (untethered / tethered) ---------- */
  var models = {
    untethered: {
      kind: "Untethered",
      heading: "Flexibility & affordability.",
      description:
        "A compact home charging solution with a universal Type 2 socket — use your own cable and keep it tucked away between charges.",
      alt: "Seven Pro untethered charger with a Type 2 socket",
      points: [
        "7.4kW smart EV charging",
        "Universal Type 2 socket",
        "Compact, space-saving design",
      ],
    },
    tethered: {
      kind: "Tethered",
      heading: "Cabled & convenient.",
      description:
        "An integrated 7.5 metre Type 2 cable for quick daily charging. Just park, plug in and charge — no separate cable required.",
      alt: "Seven Pro tethered charger with its integrated Type 2 cable",
      points: [
        "7.5 metre integrated cable",
        "Advanced smart connectivity",
        "Modular push-fit design",
      ],
    },
  };
  var modelButtons = Array.prototype.slice.call(
    document.querySelectorAll("[data-model]")
  );
  function setText(sel, text) {
    var el = document.querySelector(sel);
    if (el) el.textContent = text;
  }
  function selectModel(button) {
    var model = button.dataset.model;
    var content = models[model];
    if (!content || button.getAttribute("aria-pressed") === "true") return;
    modelButtons.forEach(function (b) {
      b.setAttribute("aria-pressed", String(b === button));
    });
    var sw = button.closest(".sp-switch");
    if (sw) sw.style.setProperty("--i", String(modelButtons.indexOf(button)));
    document.querySelectorAll("[data-model-img]").forEach(function (img) {
      var on = img.dataset.modelImg === model;
      img.classList.toggle("is-active", on);
      img.alt = on ? content.alt : "";
      img.toggleAttribute("aria-hidden", !on);
    });
    var panel = document.querySelector(".sp-model");
    var swap = function () {
      setText("#model-kind", content.kind);
      setText("#model-heading", content.heading);
      setText("#model-description", content.description);
      var ul = document.querySelector("#model-points");
      if (ul) {
        ul.innerHTML = "";
        content.points.forEach(function (p) {
          var li = document.createElement("li");
          li.textContent = p;
          ul.appendChild(li);
        });
      }
      if (panel) panel.classList.remove("is-swapping");
    };
    if (panel && !reduceMotion) {
      panel.classList.add("is-swapping");
      setTimeout(swap, 180);
    } else swap();
  }
  modelButtons.forEach(function (button, i) {
    button.addEventListener("click", function () {
      selectModel(button);
    });
    button.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      var next =
        modelButtons[
          (i + (e.key === "ArrowRight" ? 1 : -1) + modelButtons.length) %
            modelButtons.length
        ];
      next.focus();
      selectModel(next);
    });
  });

  /* ---------- Seven Pro features: auto-cycle while in view ---------- */
  var sp = document.querySelector(".sp");
  var features = Array.prototype.slice.call(
    document.querySelectorAll(".sp-feature")
  );
  function selectFeature(index) {
    features.forEach(function (f, i) {
      f.setAttribute("aria-pressed", String(i === index));
    });
    var bar = features[index] && features[index].querySelector(".sp-f-progress");
    if (bar) {
      bar.style.animation = "none";
      void bar.offsetWidth;
      bar.style.animation = "";
    }
  }
  features.forEach(function (f, i) {
    f.addEventListener("click", function () {
      selectFeature(i);
    });
    var bar = f.querySelector(".sp-f-progress");
    if (bar)
      bar.addEventListener("animationend", function () {
        selectFeature((i + 1) % features.length);
      });
  });
  if (sp && features.length && !reduceMotion && "IntersectionObserver" in window) {
    var featureBox = document.querySelector(".sp-features");
    var pauseSp = function (on) {
      sp.classList.toggle("is-paused", on);
    };
    new IntersectionObserver(
      function (entries) {
        sp.classList.add("is-cycling");
        pauseSp(!entries[0].isIntersecting);
      },
      { threshold: 0.35 }
    ).observe(sp);
    if (featureBox) {
      featureBox.addEventListener("pointerenter", function () {
        pauseSp(true);
      });
      featureBox.addEventListener("pointerleave", function () {
        pauseSp(false);
      });
      featureBox.addEventListener("focusin", function () {
        pauseSp(true);
      });
      featureBox.addEventListener("focusout", function () {
        pauseSp(false);
      });
    }
  }

  /* ---------- Stage parallax ---------- */
  var product = document.querySelector(".sp-product");
  if (sp && product && !reduceMotion && "IntersectionObserver" in window) {
    var visible = false,
      ticking = false;
    var parallax = function () {
      ticking = false;
      var r = sp.getBoundingClientRect();
      var progress = (r.top + r.height / 2 - innerHeight / 2) / innerHeight;
      product.style.setProperty(
        "--py",
        Math.max(-1, Math.min(1, progress)) * 30 + "px"
      );
    };
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible) parallax();
    }).observe(sp);
    window.addEventListener(
      "scroll",
      function () {
        if (visible && !ticking) {
          ticking = true;
          requestAnimationFrame(parallax);
        }
      },
      { passive: true }
    );
  }

  /* ---------- App section: one feature open at a time, auto-rotate ---------- */
  var apSection = document.querySelector(".ap");
  var apItems = Array.prototype.slice.call(document.querySelectorAll(".ap-item"));
  function selectApItem(index) {
    apItems.forEach(function (item, i) {
      item.setAttribute("aria-expanded", String(i === index));
    });
    var bar = apItems[index] && apItems[index].querySelector(".ap-progress");
    if (bar) {
      bar.style.animation = "none";
      void bar.offsetWidth;
      bar.style.animation = "";
    }
  }
  apItems.forEach(function (item, i) {
    item.addEventListener("click", function () {
      selectApItem(i);
    });
    var bar = item.querySelector(".ap-progress");
    if (bar)
      bar.addEventListener("animationend", function () {
        selectApItem((i + 1) % apItems.length);
      });
  });
  if (apSection && apItems.length && !reduceMotion && "IntersectionObserver" in window) {
    var apList = document.querySelector(".ap-list");
    var started = false;
    var pauseAp = function (on) {
      apSection.classList.toggle("is-paused", on);
    };
    new IntersectionObserver(
      function (entries) {
        if (entries[0].isIntersecting && !started) {
          started = true;
          selectApItem(0);
          apSection.classList.add("is-cycling");
        }
        pauseAp(!entries[0].isIntersecting);
      },
      { threshold: 0.4 }
    ).observe(apSection);
    if (apList) {
      apList.addEventListener("pointerenter", function () {
        pauseAp(true);
      });
      apList.addEventListener("pointerleave", function () {
        pauseAp(false);
      });
      apList.addEventListener("focusin", function () {
        pauseAp(true);
      });
      apList.addEventListener("focusout", function () {
        pauseAp(false);
      });
    }
  }

  /* ---------- Horizontal carousels (tariffs + partners) ---------- */
  document.querySelectorAll("[data-carousel]").forEach(function (carousel) {
    var track = carousel.querySelector("[data-carousel-track]");
    var prev = carousel.querySelector("[data-carousel-prev]");
    var next = carousel.querySelector("[data-carousel-next]");
    if (!track) return;
    var items = track.querySelectorAll(":scope > *");
    var stepBy = function () {
      var first = track.querySelector(":scope > *");
      if (!first) return track.clientWidth * 0.9;
      var gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap || "18") || 18;
      return first.getBoundingClientRect().width + gap;
    };
    // Swipe affordance: pagination dots (shown on mobile via CSS)
    var dotsWrap = null;
    if (items.length > 1) {
      dotsWrap = document.createElement("div");
      dotsWrap.className = "carousel-dots";
      items.forEach(function (item, i) {
        var dot = document.createElement("button");
        dot.type = "button";
        dot.className = "carousel-dot";
        dot.setAttribute("aria-label", "Go to item " + (i + 1));
        dot.addEventListener("click", function () {
          track.scrollTo({ left: i * stepBy(), behavior: "smooth" });
        });
        dotsWrap.appendChild(dot);
      });
      carousel.appendChild(dotsWrap);
    }
    var update = function () {
      var maxScroll = track.scrollWidth - track.clientWidth - 2;
      if (prev) prev.disabled = track.scrollLeft <= 2;
      if (next) next.disabled = track.scrollLeft >= maxScroll;
      // edge-fade state (hides the left/right fade at the ends)
      carousel.classList.toggle("is-start", track.scrollLeft <= 2);
      carousel.classList.toggle("is-end", track.scrollLeft >= maxScroll);
      // active dot
      if (dotsWrap) {
        var step = stepBy() || 1;
        var active = Math.round(track.scrollLeft / step);
        if (active < 0) active = 0;
        if (active > items.length - 1) active = items.length - 1;
        for (var d = 0; d < dotsWrap.children.length; d++) {
          dotsWrap.children[d].classList.toggle("is-active", d === active);
        }
      }
    };
    if (prev)
      prev.addEventListener("click", function () {
        track.scrollBy({ left: -stepBy(), behavior: "smooth" });
      });
    if (next)
      next.addEventListener("click", function () {
        track.scrollBy({ left: stepBy(), behavior: "smooth" });
      });
    track.addEventListener("scroll", function () {
      window.requestAnimationFrame(update);
    }, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    update();
  });

  /* ---------- FAQ accordion (single-open) ---------- */
  var faqButtons = Array.prototype.slice.call(
    document.querySelectorAll(".faq-list .faq-q")
  );
  faqButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var isOpen = btn.getAttribute("aria-expanded") === "true";
      faqButtons.forEach(function (b) {
        b.setAttribute("aria-expanded", "false");
      });
      btn.setAttribute("aria-expanded", String(!isOpen));
    });
  });

  /* ---------- EV tariff calculator ---------- */
  var energy = document.querySelector("#energy");
  var standard = document.querySelector("#standard-rate");
  var offpeak = document.querySelector("#offpeak-rate");
  if (energy && standard && offpeak) {
    var money = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
    });
    var calculate = function () {
      setText("#energy-output", energy.value + " kWh");
      var out = document.querySelector("#energy-output");
      if (out) out.value = energy.value + " kWh";
      var valid =
        standard.value !== "" &&
        offpeak.value !== "" &&
        standard.validity.valid &&
        offpeak.validity.valid;
      if (!valid) {
        setText("#standard-cost", "—");
        setText("#offpeak-cost", "—");
        setText("#difference", "Enter rates between 0 and 200 p/kWh to compare.");
        return;
      }
      var amount = Number(energy.value);
      var s = (amount * Number(standard.value)) / 100;
      var o = (amount * Number(offpeak.value)) / 100;
      var max = Math.max(s, o);
      setText("#standard-cost", money.format(s));
      setText("#offpeak-cost", money.format(o));
      var sb = document.querySelector("#standard-bar");
      var ob = document.querySelector("#offpeak-bar");
      if (sb) sb.style.width = (max ? (s / max) * 100 : 0) + "%";
      if (ob) ob.style.width = (max ? (o / max) * 100 : 0) + "%";
      var difference = s - o;
      setText(
        "#difference",
        Math.abs(difference) < 0.005
          ? "The same energy cost at these rates"
          : money.format(Math.abs(difference)) +
              " " +
              (difference > 0 ? "less" : "more") +
              " for this charge at the off-peak rate"
      );
    };
    [energy, standard, offpeak].forEach(function (input) {
      input.addEventListener("input", calculate);
    });
    var reset = document.querySelector("#reset-calculator");
    if (reset)
      reset.addEventListener("click", function () {
        energy.value = 60;
        standard.value = 26.11;
        offpeak.value = 7.5;
        calculate();
      });
    calculate();
  }

  /* ---------- Mobile sticky CTA ---------- */
  var sticky = document.querySelector(".mobile-cta");
  var heroEl = document.querySelector(".hero");
  if (sticky && heroEl && "IntersectionObserver" in window) {
    new IntersectionObserver(
      function (entries) {
        sticky.classList.toggle("show", !entries[0].isIntersecting);
      },
      { threshold: 0 }
    ).observe(heroEl);
  }

  /* ---------- Checkout links: carry marketing attribution only ---------- */
  var incoming = new URLSearchParams(location.search);
  document.querySelectorAll("a.checkout").forEach(function (link) {
    try {
      var target = new URL(link.href, location.origin);
      target.searchParams.set("utm_source", "vchrgd");
      target.searchParams.set("utm_medium", "landing-page");
      target.searchParams.set("utm_campaign", "seven-pro");
      ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(
        function (key) {
          var value = incoming.get(key);
          if (value && value.length <= 180) target.searchParams.set(key, value);
        }
      );
      link.href = target.toString();
    } catch (e) {}
  });

  /* ---------- Header: solid once scrolled ---------- */
  var header = document.querySelector(".header");
  if (header) {
    var syncHeader = function () {
      header.classList.toggle("scrolled", window.scrollY > 8);
    };
    syncHeader();
    window.addEventListener("scroll", syncHeader, { passive: true });
  }

  /* ---------- Scroll reveal ---------- */
  var revealItems = document.querySelectorAll("[data-reveal]");
  var reveal = function (el) {
    el.classList.add("in");
    setTimeout(function () {
      el.removeAttribute("data-reveal");
    }, 1200);
  };
  if ("IntersectionObserver" in window && !reduceMotion) {
    var revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            reveal(entry.target);
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    revealItems.forEach(function (el) {
      revealObserver.observe(el);
    });
  } else {
    revealItems.forEach(reveal);
  }
})();

// Interactive installer finder: self-hosted Leaflet + marker clustering +
// OpenStreetMap tiles, synced with a searchable results list.
// Data: /home-page/installers.json (pre-geocoded offline).
(function () {
  const mapEl = document.getElementById("installer-map");
  const listEl = document.getElementById("installer-list");
  const countEl = document.getElementById("installer-count");
  const searchEl = document.getElementById("installer-search");
  if (!mapEl || !listEl || typeof L === "undefined") return;

  // Red teardrop pin (inline SVG, no extra assets needed).
  const pinSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="38" viewBox="0 0 26 38">' +
    '<path d="M13 0C5.8 0 0 5.8 0 13c0 9.2 13 25 13 25s13-15.8 13-25C26 5.8 20.2 0 13 0z" fill="#e11d2a"/>' +
    '<circle cx="13" cy="13" r="5" fill="#fff"/></svg>';
  const redIcon = L.divIcon({
    html: pinSvg,
    className: "inst-pin",
    iconSize: [26, 38],
    iconAnchor: [13, 38],
    popupAnchor: [0, -34],
  });

  const map = L.map(mapEl, { scrollWheelZoom: false }).setView([54.5, -3.2], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  map.on("focus", () => map.scrollWheelZoom.enable());
  map.on("blur", () => map.scrollWheelZoom.disable());

  // On touch devices, don't trap page scroll: require a tap on the map before
  // one-finger dragging works. Two-finger gestures still work any time.
  const isTouch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  if (isTouch) {
    map.dragging.disable();
    mapEl.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches && e.touches.length >= 2) map.dragging.enable();
      },
      { passive: true },
    );
    map.on("click", () => map.dragging.enable());
  }

  // Red clustering: badges radiate/split as you zoom in (like the old site).
  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 48,
    spiderfyOnMaxZoom: true,
    iconCreateFunction: (c) => {
      const n = c.getChildCount();
      const size = n < 10 ? 38 : n < 50 ? 46 : 54;
      return L.divIcon({
        html: "<span>" + n + "</span>",
        className: "inst-cluster",
        iconSize: [size, size],
      });
    },
  });
  map.addLayer(cluster);

  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const telHref = (p) => "tel:" + String(p).replace(/\s+/g, "");

  let installers = [];
  const markers = new Map(); // index -> marker
  let items = []; // index -> list button

  function popupHtml(inst) {
    return (
      '<div class="inst-pop"><h4>' +
      escapeHtml(inst.name) +
      "</h4><p>" +
      escapeHtml(inst.address) +
      '</p><a href="' +
      telHref(inst.phone) +
      '">' +
      escapeHtml(inst.phone) +
      "</a></div>"
    );
  }

  function focusInstaller(i) {
    const marker = markers.get(i);
    items.forEach((btn, idx) => btn && btn.classList.toggle("is-active", idx === i));
    if (!marker) return;
    // Zoom out of the cluster so the individual pin shows, then open its popup.
    cluster.zoomToShowLayer(marker, () => marker.openPopup());
  }

  function render(filter) {
    const q = (filter || "").trim().toLowerCase();
    listEl.innerHTML = "";
    items = [];
    cluster.clearLayers();
    let shown = 0;
    const visibleMarkers = [];

    installers.forEach((inst, i) => {
      const haystack = (inst.name + " " + inst.address + " " + (inst.postcode || "")).toLowerCase();
      if (q && !haystack.includes(q)) return;
      shown++;

      const marker = markers.get(i);
      if (marker) {
        cluster.addLayer(marker);
        visibleMarkers.push(marker);
      }

      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "installer-item";
      btn.innerHTML =
        "<h4>" +
        escapeHtml(inst.name) +
        '</h4><span class="inst-addr">' +
        escapeHtml(inst.address) +
        '</span><span class="inst-phone">' +
        escapeHtml(inst.phone) +
        "</span>";
      btn.addEventListener("click", () => focusInstaller(i));
      li.appendChild(btn);
      listEl.appendChild(li);
      items[i] = btn;
    });

    if (shown === 0) {
      const empty = document.createElement("li");
      empty.className = "installer-empty";
      empty.textContent = "No installers match your search. Try a town or postcode.";
      listEl.appendChild(empty);
    }

    countEl.textContent = q
      ? shown + " of " + installers.length + " installers"
      : installers.length + " approved installers nationwide";

    // When filtering, fit the map to what matched.
    if (q && visibleMarkers.length) {
      map.fitBounds(L.featureGroup(visibleMarkers).getBounds(), { padding: [40, 40], maxZoom: 13 });
    }
  }

  fetch("/home-page/installers.json")
    .then((r) => r.json())
    .then((data) => {
      installers = data.filter((d) => typeof d.lat === "number" && typeof d.lng === "number");
      const bounds = [];
      installers.forEach((inst, i) => {
        const marker = L.marker([inst.lat, inst.lng], { icon: redIcon }).bindPopup(popupHtml(inst));
        marker.on("click", () => {
          items.forEach((btn, idx) => btn && btn.classList.toggle("is-active", idx === i));
        });
        markers.set(i, marker);
        bounds.push([inst.lat, inst.lng]);
      });
      render("");
      if (bounds.length) map.fitBounds(bounds, { padding: [30, 30] });
      setTimeout(() => map.invalidateSize(), 200);
    })
    .catch(() => {
      countEl.textContent = "Installer list is temporarily unavailable.";
    });

  if (searchEl) {
    let t;
    searchEl.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => render(searchEl.value), 120);
    });
  }

  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries, obs) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          map.invalidateSize();
          obs.disconnect();
        }
      });
    }).observe(mapEl);
  }
})();

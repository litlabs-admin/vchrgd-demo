// One-time offline geocoder for the installer finder map.
// Reads scripts/installers.raw.json (name, address, phone), resolves each to
// lat/lng, and writes public/home-page/installers.json for the map + search.
//
// Strategy:
//  1) Extract a UK postcode from each address and bulk-geocode via postcodes.io
//     (free, no key). Most reliable for UK.
//  2) Any address without a resolvable postcode falls back to Nominatim
//     (OpenStreetMap) using the full address string (1 req/sec, polite UA).
//
// Run: node scripts/geocode-installers.mjs

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const RAW = path.join(ROOT, "scripts", "installers.raw.json");
const OUT = path.join(ROOT, "public", "home-page", "installers.json");

const UK_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

function extractPostcode(address) {
  const m = address.toUpperCase().match(UK_POSTCODE);
  return m ? `${m[1]} ${m[2]}` : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bulkPostcodes(postcodes) {
  const unique = [...new Set(postcodes.filter(Boolean))];
  const lookup = new Map();
  // postcodes.io bulk endpoint accepts up to 100 per request.
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const res = await fetch("https://api.postcodes.io/postcodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postcodes: batch }),
    });
    const json = await res.json();
    for (const row of json.result ?? []) {
      if (row.result && typeof row.result.latitude === "number") {
        lookup.set(row.query.toUpperCase().replace(/\s+/g, " ").trim(), {
          lat: row.result.latitude,
          lng: row.result.longitude,
        });
      }
    }
  }
  return lookup;
}

async function nominatim(address) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", `${address}, UK`);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "gb");
  const res = await fetch(url, {
    headers: { "User-Agent": "vchrgd-installer-geocoder/1.0 (demo)" },
  });
  const json = await res.json();
  if (Array.isArray(json) && json[0]) {
    return { lat: Number(json[0].lat), lng: Number(json[0].lon) };
  }
  return null;
}

async function main() {
  const raw = JSON.parse(await readFile(RAW, "utf8"));
  const postcodes = raw.map((r) => extractPostcode(r.address));
  console.log(`Geocoding ${raw.length} installers…`);

  const pcLookup = await bulkPostcodes(postcodes);

  const out = [];
  const failures = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    const pc = postcodes[i];
    const key = pc ? pc.toUpperCase().replace(/\s+/g, " ").trim() : null;
    let coords = key ? pcLookup.get(key) : null;

    if (!coords) {
      // Fallback to Nominatim (rate-limited to 1 req/sec).
      await sleep(1100);
      try {
        coords = await nominatim(item.address);
      } catch {
        coords = null;
      }
    }

    if (coords) {
      out.push({
        name: item.name,
        address: item.address,
        phone: item.phone,
        postcode: pc ?? null,
        lat: Number(coords.lat.toFixed(6)),
        lng: Number(coords.lng.toFixed(6)),
      });
    } else {
      failures.push(item.name);
      out.push({
        name: item.name,
        address: item.address,
        phone: item.phone,
        postcode: pc ?? null,
        lat: null,
        lng: null,
      });
    }
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  await writeFile(OUT, JSON.stringify(out, null, 2) + "\n");

  const located = out.filter((o) => o.lat != null).length;
  console.log(`Done. ${located}/${out.length} located. Written to ${OUT}`);
  if (failures.length) console.log("No coordinates for:", failures.join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

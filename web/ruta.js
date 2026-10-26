const OSRM = "https://router.project-osrm.org/route/v1/driving/";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const CORREDOR_M = 2500;
const MAX_REFINADOS = 24;
const capaRuta = L.layerGroup().addTo(mapa);

async function osrm(puntos, geometria) {
  const coords = puntos.map(([la, lo]) => `${lo.toFixed(5)},${la.toFixed(5)}`).join(";");
  const r = await fetch(`${OSRM}${coords}?overview=${geometria ? "full&geometries=geojson" : "false"}`);
  if (!r.ok) throw new Error(`OSRM ${r.status}`);
  const j = await r.json();
  if (j.code !== "Ok") throw new Error(j.code);
  return j.routes[0];
}

function aMetros(lat0, lon0) {
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320, ky = 110540;
  return ([la, lo]) => [(lo - lon0) * kx, (la - lat0) * ky];
}

async function trazarRuta(dest, nombre) {
  toast("Calculando ruta…");
  let r;
  try {
    r = await osrm([state.origen, dest], true);
  } catch {
    toast("No pude calcular la ruta. Revisa tu conexión e intenta otra vez.");
    return;
  }
  const geom = r.geometry.coordinates.map(([lo, la]) => [la, lo]);
  const m = aMetros(state.origen[0], state.origen[1]);
  state.ruta = { dest, nombre, km: r.distance / 1000, min: r.duration / 60, base: r.distance, geom,
    xy: geom.map(m), m, real: new Map(), pedidos: new Set() };
  capaRuta.clearLayers();
  L.polyline(geom, { color: "#0f62fe", weight: 6, opacity: 0.55 }).addTo(capaRuta);
  L.marker(dest, { icon: L.divIcon({ className: "", html: '<div class="destino">🏁</div>', iconSize: [28, 28], iconAnchor: [6, 26] }) }).addTo(capaRuta);
  mapa.fitBounds(L.latLngBounds(geom), { padding: [30, 30] });
  $("radio-wrap").hidden = true;
  render();
}

function quitarRuta() {
  state.ruta = null;
  capaRuta.clearLayers();
  $("radio-wrap").hidden = false;
  render();
  mapa.setView(state.origen, 14);
}

function distSegmento([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// Desvío aproximado: ir y volver a la ruta en línea recta (× factor de pistas); luego se confirma con OSRM.
function calcularDesvios() {
  const { xy, m, real } = state.ruta;
  for (const g of grifos) {
    if (real.has(g.id)) {
      g.desvio = real.get(g.id);
      g.desvioReal = true;
      continue;
    }
    const p = m([g.lat, g.lon]);
    let d = Infinity;
    for (let i = 1; i < xy.length && d > 0; i++) {
      const [ax, ay] = xy[i - 1], [bx, by] = xy[i];
      if (Math.min(ax, bx) - p[0] > d || p[0] - Math.max(ax, bx) > d || Math.min(ay, by) - p[1] > d || p[1] - Math.max(ay, by) > d) continue;
      d = Math.min(d, distSegmento(p, xy[i - 1], xy[i]));
    }
    g.desvio = d <= CORREDOR_M ? (2 * d * FACTOR_VIA) / 1000 : null;
    g.desvioReal = false;
  }
}

let refinando = false;
async function refinarDesvios(lista) {
  const ruta = state.ruta;
  if (refinando || !ruta || ruta.pedidos.size >= MAX_REFINADOS) return;
  const faltan = lista.filter((g) => !ruta.real.has(g.id) && !ruta.pedidos.has(g.id)).slice(0, 6);
  if (!faltan.length) return;
  refinando = true;
  for (const g of faltan) {
    ruta.pedidos.add(g.id);
    try {
      const r = await osrm([state.origen, [g.lat, g.lon], ruta.dest], false);
      ruta.real.set(g.id, Math.max(0, (r.distance - ruta.base) / 1000));
    } catch { /* se queda con el aproximado */ }
  }
  refinando = false;
  if (state.ruta === ruta) render();
}

function renderRutaInfo() {
  const r = state.ruta;
  $("ruta-info").innerHTML = r
    ? `<div class="ruta-info"><span>🛣️ Hacia <b>${esc(r.nombre)}</b> · ${r.km.toFixed(1)} km · ${Math.round(r.min)} min</span>
       <button type="button" class="mini" id="ruta-quitar">✕ Quitar ruta</button></div>`
    : "";
}

async function buscarDestino() {
  const q = $("ruta-q").value.trim();
  if (q.length < 3) return toast("Escribe un lugar o dirección");
  $("ruta-res").innerHTML = "<li class='ayuda'>Buscando…</li>";
  const url = `${NOMINATIM}?format=jsonv2&limit=6&countrycodes=pe&bounded=1&viewbox=-77.25,-11.70,-76.60,-12.55&accept-language=es&q=${encodeURIComponent(q)}`;
  try {
    const res = await (await fetch(url)).json();
    $("ruta-res").innerHTML = res.length
      ? res.map((x) => `<li><button type="button" data-lat="${x.lat}" data-lon="${x.lon}" data-nombre="${esc(x.name || x.display_name.split(",")[0])}">
          <b>${esc(x.name || x.display_name.split(",")[0])}</b><small>${esc(x.display_name.split(",").slice(1, 4).join(","))}</small></button></li>`).join("")
      : "<li class='ayuda'>No encontré ese lugar en Lima. Prueba con otra referencia o elígelo en el mapa.</li>";
  } catch {
    $("ruta-res").innerHTML = "<li class='ayuda'>No pude buscar ahora. Elige el destino en el mapa.</li>";
  }
}

function elegirDestinoEn(latlng) {
  state.elegirDestino = false;
  $("mapa").classList.remove("eligiendo");
  trazarRuta(latlng, "punto del mapa");
}

$("abrir-ruta").addEventListener("click", () => {
  $("dlg-ruta").showModal();
  $("ruta-q").focus();
});
$("ruta-buscar").addEventListener("click", buscarDestino);
$("ruta-q").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); buscarDestino(); } });
$("ruta-res").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-lat]");
  if (!b) return;
  $("dlg-ruta").close();
  trazarRuta([Number(b.dataset.lat), Number(b.dataset.lon)], b.dataset.nombre);
});
$("ruta-mapa").addEventListener("click", () => {
  $("dlg-ruta").close();
  state.elegirDestino = true;
  $("mapa").classList.add("eligiendo");
  if (matchMedia("(max-width: 760px)").matches) scrollTo({ top: 0, behavior: "smooth" });
  toast("Toca tu destino en el mapa");
});
$("ruta-info").addEventListener("click", (e) => { if (e.target.closest("#ruta-quitar")) quitarRuta(); });

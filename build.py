#!/usr/bin/env python3
"""Genera web/data/grifos.json: precios de Osinergmin (SCOP, diario) cruzados con grifos de OpenStreetMap."""
import argparse
import bisect
import csv
import hashlib
import io
import json
import math
import re
import statistics
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "cache"
OUT = ROOT / "web" / "data" / "grifos.json"
UA = "grifos-lima/0.1 (uso personal; https://github.com/debugsito)"

SCOP = "https://www.osinergmin.gob.pe/seccion/centro_documental/hidrocarburos/SCOP/SCOP-DOCS/Reporte-Diario/"
CL_URL = SCOP + "CL-Registro-precios-DMA-V-CCA-CCE.csv"
GLP_URL = SCOP + "GLP-Registro-precios-PIC-PE-V.csv"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
NOMINATIM = "https://nominatim.openstreetmap.org/search"
KML_RADIO_M = 150
KML_RADIO_CALLE_M = 600

OVERPASS_QUERY = """[out:json][timeout:900];
(area["name"="Lima Metropolitana"]["boundary"="administrative"];area["name"="Callao"]["admin_level"="4"];)->.metro;
nwr["amenity"="fuel"](area.metro)->.all;
foreach.all->.s(
  .s out center tags;
  (node.s;node(w.s);)->.p;
  .p is_in->.ar;
  area.ar["admin_level"="8"];
  out tags;
  way(around.s:70)["highway"]["name"];
  out tags;
  make sep;
  out;
);"""

NOT_RETAIL = ("MAYORISTA", "PLANTA", "COMERCIALIZADOR", "PRODUCTOR", "IMPORTADOR", "CONSUMIDOR")

BRANDS = [
    ("Repsol", ["REPSOL"]),
    ("Primax", ["PRIMAX", "COESTI"]),
    ("Pecsa", ["PECSA", "PERUANA DE ESTACIONES DE SERVICIOS"]),
    ("Petroperú", ["PETROPERU", "PETRO PERU"]),
    ("Terpel", ["TERPEL"]),
    ("Gazel", ["GAZEL", "GAZZEL"]),
    ("Energigas", ["ENERGIGAS"]),
    ("PetroAmérica", ["PETROAMERICA", "PETRO AMERICA"]),
    ("Mobil", ["MOBIL"]),
    ("Shell", ["SHELL"]),
    ("Aba Singer", ["ABA SINGER"]),
    ("Gaspetrol", ["GASPETROL"]),
    ("Enpex", ["ENPEX"]),
    ("Herco", ["HERCO"]),
    ("Ava", ["AVA"]),
    ("GES", ["GES", "GRIFOS GES"]),
]
# Solo razones sociales que identifican la marca sin ambigüedad (dueñas de red propia).
CORPORATE = {"REPSOL COMERCIAL": "Repsol", "COESTI": "Primax", "PRIMAX": "Primax",
             "PERUANA DE ESTACIONES DE SERVICIOS": "Pecsa", "TERPEL": "Terpel", "ENERGIGAS": "Energigas"}

STREET_TYPES = {"AV", "AVE", "AVDA", "AVENIDA", "JR", "JIRON", "CALLE", "CAL", "CA", "CL", "CARRETERA", "CARR", "CAR",
                "CARRET", "CTRA", "PROLONGACION", "PROLONG", "PROL", "PJE", "PSJE", "PASAJE", "ALAMEDA", "MALECON",
                "OVALO", "VIA", "ANTIGUA", "NUEVA", "PANAM", "AUTOPISTA"}
STOP = {"DE", "DEL", "LA", "LAS", "LOS", "EL", "Y", "E", "A", "EN", "AL", "CON", "ESQ", "ESQUINA"}
ABBR = {"FCO": "FRANCISCO", "STA": "SANTA", "STO": "SANTO", "GRAL": "GENERAL", "PDTE": "PRESIDENTE", "MCAL": "MARISCAL",
        "CDTE": "COMANDANTE", "CNEL": "CORONEL", "CRNEL": "CORONEL", "ING": "INGENIERO", "DR": "DOCTOR", "REP": "REPUBLICA",
        "MANCO": "MANCO", "PANAMERICANA": "PANAMERICANA", "PANAM": "PANAMERICANA", "NAC": "NACIONAL", "UNIV": "UNIVERSITARIA"}
# Opera sobre texto ya normalizado: norm() convierte "N°" en "N" y "Nº" en "NO".
NUM_MARK = r"(?:N|NO|NRO|NUM|NUMERO)\.?\s*(?=\d)"
CUT = re.compile(r"\s(?:" + NUM_MARK + r"|#|MZ\w*\.?|LT\w*\.?|LOTE\w*|KM\.?|CDRA\w*\.?|CUADRA|URB\w*\.?|AA\.?\s?HH\.?|"
                 r"ASOC\w*\.?|ALT\w*\.?|ALTURA|S/N|SN|SUB\s?LOTE|PARCELA|SECTOR|P\.?J\.?|COOP\w*\.?|ANTES|EX)(?=[\s\d.]|$)|[,(;]|\s-\s")
CORNER = re.compile(r"\s(?:ESQ\w*\.?(?:\s+CON)?(?:\s+(?:LA|EL))?|INTERSECCION(?:\s+(?:DE|CON))?|CRUCE(?:\s+(?:DE|CON))?|CON|"
                    r"Y(?=\s+(?:AV|JR|CALLE|CAL|CA|PSJE|PJE|PASAJE|PROLONGACION|CARRETERA)\b)|/)\s")
NUMBER = re.compile(r"\b(?:N|NO|NRO|NUM|NUMERO)\.?\s*(\d+)")


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().upper()
    return re.sub(r"\s+", " ", s).strip()


def tokens(s):
    out = set()
    for t in re.sub(r"[^A-Z0-9 ]", " ", norm(s)).split():
        t = ABBR.get(t, t)
        if t in STREET_TYPES or t in STOP or len(t) < 2 or (t.isdigit() and len(t) >= 3):
            continue
        out.add(t)
    return out


def street_sim(a, b):
    if not a or not b:
        return 0.0
    m = sum(1 for x in a if any(x == y or (min(len(x), len(y)) >= 3 and (x.startswith(y) or y.startswith(x))) for y in b))
    return 2 * m / (len(a) + len(b))


def parse_streets(address):
    addr = re.sub(r"\.(?=\S)", ". ", norm(address))
    addr = re.sub(r"^(AV|JR|CALLE|CAL|CA)\s*,", r"\1 ", addr)
    addr = re.sub(r"^(?:(?:KM|MZ|LT|LOTE)\.?\s*[\w.,-]+\s+(?:DE\s+)?(?:LA\s+|EL\s+)?)+", "", addr)
    addr = " " + addr + " "
    parts = CORNER.split(addr)
    streets = []
    for p in parts:
        p = CUT.split(" " + p.strip())[0]
        t = tokens(p)
        if t:
            streets.append(t)
    num = NUMBER.search(addr)
    return streets, (num.group(1) if num else None)


def brand_from_text(*texts):
    for text in texts:
        t = " " + re.sub(r"[^A-Z0-9 ]", " ", norm(text)) + " "
        for brand, keys in BRANDS:
            if any(f" {k} " in t for k in keys):
                return brand
    return None


def brand_from_razon(razon):
    r = re.sub(r"[^A-Z0-9 ]", " ", norm(razon))
    for k, brand in CORPORATE.items():
        if k in r:
            return brand
    return None


def http_get(url, timeout=120, data=None):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=timeout)


def last_modified(url):
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.headers.get("Last-Modified")


def in_metro(dep, prov):
    return "CALLAO" in dep or (dep == "LIMA" and prov == "LIMA")


def cl_product(prod, unit):
    p = norm(prod)
    if p == "GASOHOL REGULAR":
        return "regular"
    if p == "GASOHOL PREMIUM":
        return "premium"
    if p.startswith("DIESEL"):
        return "diesel"
    if p == "GAS NATURAL VEHICULAR COMPRIMIDO" and norm(unit).startswith("METROS"):
        return "gnv"
    return None


def glp_product(prod, client, unit):
    return "glp" if norm(prod) == "GLP - G" and norm(client) == "USUARIO FINAL" and norm(unit) == "GALONES" else None


def stream_prices(url, stations, kind):
    """Lee el CSV en streaming (pesa >1 GB) y guarda el último precio por grifo y producto."""
    t0 = time.time()
    with http_get(url, timeout=600) as resp:
        reader = csv.reader(io.TextIOWrapper(resp, encoding="utf-8-sig", newline=""), delimiter=";")
        next(reader)
        for n, row in enumerate(reader, 1):
            if n % 200000 == 0:
                print(f"  {kind}: {n:,} filas ({time.time() - t0:.0f}s)", file=sys.stderr)
            if len(row) < 13:
                continue
            row = [c.strip() for c in row]
            if not in_metro(row[5], row[6]) or any(k in norm(row[1]) for k in NOT_RETAIL):
                continue
            if kind == "cl":
                prod, price, unit = cl_product(row[10], row[12]), row[11], row[12]
            else:
                if len(row) < 15:
                    continue
                prod, price = glp_product(row[10], row[11], row[14]), row[13]
            if not prod:
                continue
            try:
                value = float(price.replace(",", "."))
            except ValueError:
                continue
            if value <= 0:
                continue
            fecha = row[9][:19].replace("/", "-")
            st = stations.setdefault(row[2], {"registro": row[2], "ruc": row[3], "razon": row[4], "distrito": row[7],
                                              "direccion": row[8], "actividad": row[1], "_h": {}})
            st["_h"].setdefault(prod, []).append((fecha, value))


def history_points(hist, days):
    """Cambios de precio de los últimos `days` días como [[fecha, precio]], con el vigente al inicio."""
    start = (datetime.strptime(hist[-1][0][:10], "%Y-%m-%d") - timedelta(days=days)).strftime("%Y-%m-%d")
    out = []
    for fecha, value in hist:
        day = fecha[:10]
        if day < start:
            out = [[start, value]]
        elif not out or out[-1][1] != value:
            if out and out[-1][0] == day:
                out[-1][1] = value
                if len(out) > 1 and out[-2][1] == value:
                    out.pop()
            else:
                out.append([day, value])
    return out


def summarize_history(stations, days=60, stale=15):
    """Último precio, desde cuándo rige y el anterior; y la mediana diaria de Lima en los últimos `days` días."""
    series = {}
    for st in stations.values():
        st["precios"] = {}
        for prod, hist in st.pop("_h").items():
            hist.sort()
            fecha, value = hist[-1]
            i = len(hist) - 1
            while i > 0 and hist[i - 1][1] == value:
                i -= 1
            rec = {"p": value, "f": fecha}
            if i > 0:
                rec.update(prev=hist[i - 1][1], desde=hist[i][0][:10])
            changes = history_points(hist, days)
            if len(changes) > 1:
                rec["h"] = changes
            st["precios"][prod] = rec
            series.setdefault(prod, []).append(hist)
    last = max((h[-1][0][:10] for hs in series.values() for h in hs), default=None)
    trend = {}
    if last:
        end = datetime.strptime(last, "%Y-%m-%d")
        for prod, hs in series.items():
            pts = []
            for k in range(days - 1, -1, -1):
                day = (end - timedelta(days=k)).strftime("%Y-%m-%d")
                lim, old = day + " 99", (end - timedelta(days=k + stale)).strftime("%Y-%m-%d")
                vals = []
                for h in hs:
                    j = bisect.bisect_right(h, (lim,)) - 1
                    if j >= 0 and h[j][0] >= old:
                        vals.append(h[j][1])
                if len(vals) >= 10:
                    pts.append([day, round(statistics.median(vals), 2)])
            trend[prod] = pts
    return trend


def load_prices(force):
    cache = CACHE / "precios.json"
    lm = {"cl": last_modified(CL_URL), "glp": last_modified(GLP_URL)}
    if cache.exists() and not force:
        data = json.loads(cache.read_text())
        if data.get("last_modified") == lm:
            print("Precios sin cambios en Osinergmin; uso caché.", file=sys.stderr)
            return data
    stations = {}
    print("Descargando precios de combustibles líquidos y GNV (~1.5 GB, en streaming)...", file=sys.stderr)
    stream_prices(CL_URL, stations, "cl")
    print("Descargando precios de GLP (~0.9 GB, en streaming)...", file=sys.stderr)
    stream_prices(GLP_URL, stations, "glp")
    data = {"last_modified": lm, "tendencia": summarize_history(stations), "stations": stations}
    cache.write_text(json.dumps(data, ensure_ascii=False))
    return data


def merge_duplicates(stations):
    """Un mismo local suele tener varios registros (re-registro, cambio de dueño, gasocentro aparte)."""
    groups = {}
    for reg, s in stations.items():
        groups.setdefault((district_key(s["distrito"]), norm(s["direccion"])), []).append(reg)
    merged = {}
    for regs in groups.values():
        latest = lambda r: max(p["f"] for p in stations[r]["precios"].values())  # noqa: E731
        regs.sort(key=latest, reverse=True)
        base = dict(stations[regs[0]], precios={}, registros=regs)
        for r in regs:
            for k, p in stations[r]["precios"].items():
                if k not in base["precios"] or p["f"] > base["precios"][k]["f"]:
                    base["precios"][k] = p
        merged[regs[0]] = base
    return merged


def load_osm(force, max_age_days=7):
    cache = CACHE / "osm.json"
    if cache.exists() and not force and time.time() - cache.stat().st_mtime < max_age_days * 86400:
        return json.loads(cache.read_text())
    body = urllib.parse.urlencode({"data": OVERPASS_QUERY}).encode()
    for attempt in range(6):
        for url in OVERPASS:
            try:
                with http_get(url, timeout=900, data=body) as r:
                    raw = json.load(r)
                break
            except Exception as e:  # noqa: BLE001
                print(f"Overpass {url}: {e}", file=sys.stderr)
        else:
            time.sleep(20 * (attempt + 1))
            continue
        break
    else:
        sys.exit("No se pudo consultar Overpass; reintenta más tarde.")
    out = parse_overpass(raw)
    cache.write_text(json.dumps(out, ensure_ascii=False))
    return out


def parse_overpass(raw):
    out, cur = [], None
    for e in raw["elements"]:
        if e["type"] == "sep":
            if cur:
                out.append(cur)
            cur = None
        elif cur is None:
            c = e.get("center") or {"lat": e.get("lat"), "lon": e.get("lon")}
            cur = {"id": f"{e['type'][0]}{e['id']}", "lat": c["lat"], "lon": c["lon"], "tags": e.get("tags", {}),
                   "distritos": [], "calles": []}
        elif e["type"] == "area":
            cur["distritos"].append(e["tags"].get("name", ""))
        else:
            cur["calles"].append(e["tags"]["name"])
    return out


def district_key(name):
    return re.sub(r"^DISTRITO (DE )?", "", norm(name))


def fill_districts(osm):
    known = [o for o in osm if o["distritos"]]
    for o in osm:
        if not o["distritos"] and known:
            near = min(known, key=lambda k: (k["lat"] - o["lat"]) ** 2 + (k["lon"] - o["lon"]) ** 2)
            o["distritos"] = near["distritos"]


def match(stations, osm):
    fill_districts(osm)
    by_district = {}
    for o in osm:
        o["_roads"] = [tokens(c) for c in o["calles"]]
        o["_brand"] = brand_from_text(o["tags"].get("brand"), o["tags"].get("name"), o["tags"].get("operator"))
        o["_op"] = tokens(o["tags"].get("operator", "") + " " + o["tags"].get("name", ""))
        for d in o["distritos"]:
            by_district.setdefault(district_key(d), []).append(o)
    generic = tokens("ESTACION ESTACIONES SERVICIO SERVICIOS GRIFO GRIFOS S A C SAC SRL S R L EIRL E I R L GAS GASOCENTRO")
    pairs = []
    for reg, s in stations.items():
        streets, num = parse_streets(s["direccion"])
        s["_brand"] = brand_from_razon(s["razon"])
        razon = tokens(s["razon"]) - generic
        for o in by_district.get(district_key(s["distrito"]), []):
            sims = [max((street_sim(st, r) for r in o["_roads"]), default=0) for st in streets]
            if not sims or sims[0] < 0.5:
                continue
            score = sims[0] + 0.5 * max(sims[1:], default=0)
            if num and o["tags"].get("addr:housenumber", "").split("-")[0].strip() == num:
                score += 0.6
            if s["_brand"] and o["_brand"]:
                same = s["_brand"] == o["_brand"] or {s["_brand"], o["_brand"]} == {"Primax", "Pecsa"}
                score += 0.4 if same else -0.4
            if razon and street_sim(razon, o["_op"]) >= 0.5:
                score += 0.3
            pairs.append((score, reg, o["id"]))
    pairs.sort(reverse=True)
    used_s, used_o, links = set(), set(), {}
    for score, reg, oid in pairs:
        if reg in used_s or oid in used_o:
            continue
        used_s.add(reg)
        used_o.add(oid)
        links[reg] = oid
    return links


def geocode(stations, links, enabled):
    cache_file = CACHE / "geocode.json"
    cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    pending = [s for reg, s in stations.items() if reg not in links]
    if enabled:
        todo = [s for s in pending if f"{s['direccion']}|{s['distrito']}" not in cache]
        if todo:
            print(f"Geocodificando {len(todo)} direcciones sin match en OSM (1 por segundo)...", file=sys.stderr)
        for i, s in enumerate(todo, 1):
            streets, _ = parse_streets(s["direccion"])
            street = " ".join(sorted(streets[0], key=lambda t: norm(s["direccion"]).find(t))) if streets else ""
            q = {"q": f"{street}, {s['distrito'].title()}, Lima, Peru", "format": "jsonv2", "limit": 1, "countrycodes": "pe"}
            try:
                with http_get(NOMINATIM + "?" + urllib.parse.urlencode(q), timeout=30) as r:
                    res = json.load(r)
                hit = res[0] if res and res[0].get("addresstype") not in ("city", "suburb", "state", "county") else None
                cache[f"{s['direccion']}|{s['distrito']}"] = [float(hit["lat"]), float(hit["lon"])] if hit else None
            except Exception as e:  # noqa: BLE001
                print(f"  nominatim: {e}", file=sys.stderr)
            if i % 50 == 0:
                cache_file.write_text(json.dumps(cache))
                print(f"  {i}/{len(todo)}", file=sys.stderr)
            time.sleep(1.1)
        cache_file.write_text(json.dumps(cache))
    return {f"{s['direccion']}|{s['distrito']}": cache.get(f"{s['direccion']}|{s['distrito']}") for s in pending}


def dist_m(a_lat, a_lon, b_lat, b_lon):
    r = math.pi / 180
    x = (b_lon - a_lon) * r * math.cos((a_lat + b_lat) * r / 2)
    return 6371000 * math.hypot(x, (b_lat - a_lat) * r)


def read_kml(path):
    if path.suffix.lower() == ".kmz":
        with zipfile.ZipFile(path) as z:
            data = z.read(next(n for n in z.namelist() if n.lower().endswith(".kml")))
    else:
        data = path.read_bytes()
    root = ET.fromstring(data)
    for el in root.iter():
        el.tag = el.tag.rsplit("}", 1)[-1]
    doc_name = (root.findtext(".//Document/name") or path.stem).strip()
    if doc_name.isupper():
        doc_name = doc_name.title()
    points = []
    for pm in root.iter("Placemark"):
        coords = pm.findtext(".//Point/coordinates")
        if not coords:
            continue
        lon, lat = (float(v) for v in coords.strip().split(",")[:2])
        fields = {(d.get("name") or ""): (d.findtext("value") or "") for d in pm.iter("Data")}
        desc = re.sub(r"<[^>]+>", " ", pm.findtext("description") or "")
        address = next((v for k, v in fields.items() if "DIREC" in norm(k)), "") or desc
        points.append({"nombre": (pm.findtext("name") or "").strip(), "lat": lat, "lon": lon, "direccion": address})
    return doc_name.strip(), points


def descargar_mapas(folder, max_age_h=20):
    """Baja los mapas listados en fuentes.txt (una URL de exportación KML de My Maps por línea)."""
    fuentes = folder / "fuentes.txt"
    if not fuentes.exists():
        return []
    out_dir = CACHE / "mapas"
    out_dir.mkdir(parents=True, exist_ok=True)
    files = []
    for url in (l.strip() for l in fuentes.read_text().splitlines()):
        if not url or url.startswith("#"):
            continue
        mid = (urllib.parse.parse_qs(urllib.parse.urlparse(url).query).get("mid") or [hashlib.sha1(url.encode()).hexdigest()[:16]])[0]
        dest = out_dir / f"{mid}.kml"
        if not dest.exists() or time.time() - dest.stat().st_mtime > max_age_h * 3600:
            try:
                with http_get(url, timeout=60) as r:
                    data = r.read()
                if b"<kml" not in data[:500]:
                    raise ValueError("la respuesta no es KML")
                dest.write_bytes(data)
            except Exception as e:
                print(f"No se pudo bajar {url}: {e}" + ("; uso la copia anterior" if dest.exists() else ""), file=sys.stderr)
        if dest.exists():
            files.append(dest)
    return files


def cruzar_mapas(records, folder):
    files = sorted(f for f in folder.glob("*") if f.suffix.lower() in (".kml", ".kmz")) if folder.is_dir() else []
    files += descargar_mapas(folder)
    located = [r for r in records if "lat" in r]
    parsed = {r["id"]: parse_streets(r["direccion"]) for r in located}
    listas = []
    for f in files:
        name, points = read_kml(f)
        brand = brand_from_text(name)
        pairs = []
        for i, pt in enumerate(points):
            streets, num = parse_streets(pt["direccion"])
            for r in located:
                d = dist_m(pt["lat"], pt["lon"], r["lat"], r["lon"])
                if d > KML_RADIO_CALLE_M:
                    continue
                r_streets, r_num = parsed[r["id"]]
                if brand and brand_from_razon(r.get("razon", "")) not in (None, brand):
                    continue
                if r.get("aprox") and not (num and num == r_num):
                    continue
                sim = street_sim(streets[0], r_streets[0]) if streets and r_streets else 0
                if d > KML_RADIO_M and sim < 0.5:
                    continue
                score = d - 100 * sim - (80 if brand and r.get("marca") == brand else 0) - (30 if r["precios"] else 0)
                pairs.append((score, i, r["id"]))
        pairs.sort()
        used_p, used_r, by_id = set(), set(), {r["id"]: r for r in located}
        for score, i, rid in pairs:
            if i in used_p or rid in used_r:
                continue
            used_p.add(i)
            used_r.add(rid)
            r = by_id[rid]
            r.setdefault("listas", []).append(name)
            if brand and r["marca"] != brand and dist_m(points[i]["lat"], points[i]["lon"], r["lat"], r["lon"]) <= 60:
                r["marca"] = brand
        missing = [points[i]["nombre"] or points[i]["direccion"] for i in range(len(points)) if i not in used_p]
        listas.append({"nombre": name, "archivo": f.name, "puntos": len(points), "cruzados": len(used_p)})
        print(f"{f.name}: {len(used_p)}/{len(points)} puntos cruzados con un grifo", file=sys.stderr)
        for m in missing[:20]:
            print(f"  sin cruce: {m}", file=sys.stderr)
    return listas


def build(args):
    CACHE.mkdir(exist_ok=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    prices = load_prices(args.force)
    stations = merge_duplicates(prices["stations"])
    osm = load_osm(args.force_osm)
    links = match(stations, osm)
    geo = geocode(stations, links, not args.no_geocode)
    osm_by_id = {o["id"]: o for o in osm}

    out, linked_osm = [], set()
    for reg, s in stations.items():
        rec = {"id": reg, "razon": s["razon"].title(), "distrito": s["distrito"].title(), "direccion": s["direccion"],
               "precios": s["precios"]}
        if reg in links:
            o = osm_by_id[links[reg]]
            linked_osm.add(o["id"])
            rec.update(lat=round(o["lat"], 6), lon=round(o["lon"], 6), osm=o["id"],
                       marca=s["_brand"] or o["_brand"] or "Otra", nombre=o["tags"].get("name"))
        else:
            pt = geo.get(f"{s['direccion']}|{s['distrito']}")
            rec.update(marca=s["_brand"] or "Otra")
            if pt:
                rec.update(lat=round(pt[0], 6), lon=round(pt[1], 6), aprox=True)
        out.append(rec)
    for o in osm:
        if o["id"] not in linked_osm:
            out.append({"id": o["id"], "osm": o["id"], "lat": round(o["lat"], 6), "lon": round(o["lon"], 6),
                        "marca": o["_brand"] or "Otra", "nombre": o["tags"].get("name"),
                        "distrito": (o["distritos"] or [""])[0], "direccion": ", ".join(o["calles"][:2]), "precios": {}})

    listas = cruzar_mapas(out, Path(args.mapas))
    con_precio = [r for r in out if r["precios"]]
    meta = {
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "osinergmin_actualizado": prices["last_modified"],
        "ultimo_registro": max((p["f"] for r in con_precio for p in r["precios"].values()), default=None),
        "grifos_con_precio": len(con_precio),
        "ubicados_osm": len(links),
        "ubicacion_aproximada": sum(1 for r in con_precio if r.get("aprox")),
        "sin_ubicacion": sum(1 for r in con_precio if "lat" not in r),
        "osm_sin_precio": len(out) - len(con_precio),
        "listas": listas,
        "tendencia": prices.get("tendencia", {}),
    }
    OUT.write_text(json.dumps({"meta": meta, "grifos": out}, ensure_ascii=False, separators=(",", ":")))
    print(json.dumps(meta, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true", help="vuelve a descargar los precios aunque no hayan cambiado")
    ap.add_argument("--force-osm", action="store_true", help="vuelve a consultar OpenStreetMap (caché de 7 días)")
    ap.add_argument("--no-geocode", action="store_true", help="no geocodifica con Nominatim los grifos sin match")
    ap.add_argument("--mapas", default=str(ROOT / "mapas"), help="carpeta con KML/KMZ exportados de My Maps a cruzar")
    build(ap.parse_args())

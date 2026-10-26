#!/usr/bin/env python3
"""API de votos y sugerencias de Grifos Lima. Solo librería estándar; guarda en /data."""
import json
import re
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

DATA = Path("/data")
FEATURES = Path("/web/features.json")
VOTER = re.compile(r"^[a-f0-9-]{16,40}$")
LOCK = threading.Lock()
HITS = defaultdict(deque)
LIMITS = {"voto": (60, 600), "sugerencia": (5, 86400)}


def feature_ids():
    try:
        return {f["id"] for f in json.loads(FEATURES.read_text())}
    except (OSError, ValueError, KeyError, TypeError):
        return set()


def load_votes():
    try:
        return {k: set(v) for k, v in json.loads((DATA / "votos.json").read_text()).items()}
    except (OSError, ValueError):
        return {}


def save_votes(votes):
    tmp = DATA / "votos.json.tmp"
    tmp.write_text(json.dumps({k: sorted(v) for k, v in votes.items()}))
    tmp.replace(DATA / "votos.json")


def allowed(ip, kind):
    n, window = LIMITS[kind]
    q, now = HITS[(ip, kind)], time.time()
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= n:
        return False
    q.append(now)
    return True


class Handler(BaseHTTPRequestHandler):
    server_version = "grifos-api"

    def log_message(self, fmt, *args):
        pass

    def ip(self):
        return (self.headers.get("Cf-Connecting-Ip") or self.headers.get("X-Forwarded-For", "").split(",")[0]
                or self.client_address[0]).strip()

    def reply(self, code, body):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > 4096:
            return None
        try:
            data = json.loads(self.rfile.read(n))
            return data if isinstance(data, dict) else None
        except ValueError:
            return None

    def do_GET(self):
        url = urlparse(self.path)
        if url.path != "/api/votos":
            return self.reply(404, {"error": "no existe"})
        voter = (parse_qs(url.query).get("v") or [""])[0]
        with LOCK:
            votes = load_votes()
        ids = feature_ids()
        self.reply(200, {"votos": {k: len(votes.get(k, ())) for k in ids},
                         "mios": sorted(k for k in ids if voter in votes.get(k, ()))})

    def do_POST(self):
        path, data = urlparse(self.path).path, self.body()
        if data is None:
            return self.reply(400, {"error": "cuerpo inválido"})
        voter = str(data.get("v", ""))
        if not VOTER.match(voter):
            return self.reply(400, {"error": "identificador inválido"})
        if path == "/api/votos":
            fid = str(data.get("id", ""))
            if fid not in feature_ids():
                return self.reply(400, {"error": "feature desconocida"})
            if not allowed(self.ip(), "voto"):
                return self.reply(429, {"error": "demasiados votos, espera un rato"})
            with LOCK:
                votes = load_votes()
                s = votes.setdefault(fid, set())
                s.symmetric_difference_update({voter})
                save_votes(votes)
                return self.reply(200, {"id": fid, "votos": len(s), "votado": voter in s})
        if path == "/api/sugerencias":
            if data.get("web"):
                return self.reply(200, {"ok": True})
            texto = re.sub(r"\s+", " ", str(data.get("texto", ""))).strip()
            if not 8 <= len(texto) <= 600:
                return self.reply(400, {"error": "escribe entre 8 y 600 caracteres"})
            if not allowed(self.ip(), "sugerencia"):
                return self.reply(429, {"error": "ya enviaste varias hoy, gracias"})
            rec = {"fecha": datetime.now(timezone.utc).isoformat(timespec="seconds"), "texto": texto,
                   "contacto": str(data.get("contacto", ""))[:120].strip(), "v": voter}
            with LOCK, (DATA / "sugerencias.jsonl").open("a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            return self.reply(200, {"ok": True})
        self.reply(404, {"error": "no existe"})


if __name__ == "__main__":
    DATA.mkdir(exist_ok=True)
    ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()

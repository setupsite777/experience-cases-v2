// W927: сервис-воркер сайта под паролем. Ключ кладёт страница пароля в IndexedDB на сутки;
// запросы внутри /experience-cases-v2/ (кроме sw.js, d/ и страниц пароля) берутся из зашифрованного d/<id>.bin.
// Нет ключа или ключ не подходит — запрос уходит на сервер, а там на любой адрес отвечает страница пароля.
const BASE = "/experience-cases-v2/", DB = "lock-experience-cases-v2-";
const OWN = new Set([BASE + "sw.js", BASE + "404.html"]);
let key = null, exp = 0, man = null;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("message", (e) => {
  if (e.data !== "reset") return;
  key = null; man = null;
  if (e.ports[0]) e.ports[0].postMessage("ok");
});

function idbGet() {
  return new Promise((res) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("k");
    r.onerror = () => res(null);
    r.onsuccess = () => {
      const q = r.result.transaction("k").objectStore("k").get("key");
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => res(null);
    };
  });
}

async function getKey() {
  if (key && Date.now() < exp) return key;
  key = null; man = null;
  const v = await idbGet();
  if (!v || !v.k || Date.now() > v.exp) return null;
  key = await crypto.subtle.importKey("raw", v.k, "AES-GCM", false, ["decrypt"]);
  exp = v.exp;
  return key;
}

async function dec(buf, k) {
  const b = new Uint8Array(buf);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: b.subarray(0, 12) }, k, b.subarray(12));
}

async function getMan(k) {
  if (man) return man;
  const r = await fetch(BASE + "d/m.bin", { cache: "no-cache" });
  man = JSON.parse(new TextDecoder().decode(await dec(await r.arrayBuffer(), k)));
  return man;
}

self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== "GET") return;
  if (!u.pathname.startsWith(BASE) || OWN.has(u.pathname) || u.pathname.startsWith(BASE + "d/")) return;
  e.respondWith(serve(e.request, u));
});

async function serve(req, u) {
  const k = await getKey();
  if (!k) return fetch(req);
  let m;
  try { m = await getMan(k); } catch (err) { key = null; man = null; return fetch(req); }
  let rel = decodeURIComponent(u.pathname.slice(BASE.length));
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const f = m.files[rel];
  if (!f) return new Response("Не найдено", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const r = await fetch(BASE + "d/" + f[0] + ".bin");
  if (!r.ok) return new Response("Не загрузилось, обновите страницу", { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  const body = await dec(await r.arrayBuffer(), k);
  const h = { "content-type": f[1], "cache-control": "no-store" };
  if (f[3]) h["content-disposition"] = f[3];
  return new Response(body, { status: 200, headers: h });
}

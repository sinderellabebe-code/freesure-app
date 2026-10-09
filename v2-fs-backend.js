/* FreeSure — Supabase bağlantı katmanı
 * Uygulamalar eskiden Apps Script adresine fetch() ile istek atıyordu. Bu dosya, API_URL = 'fsapi://x'
 * adresine giden istekleri yakalar ve Supabase'e (tek bir "api" veritabanı fonksiyonu) yönlendirir;
 * cevaplar eski biçimle aynıdır. Oturum Supabase Auth ile tutulur (e-posta + parola). */
(function(){
'use strict';
const CFG = {
  url: 'https://arwehyytxmtbngeehall.supabase.co',
  key: 'sb_publishable_FrNGdFgDRSImV33k_8eiyA_Y954Auux',
  bucket: 'model-images'
};
if(!window.supabase || !window.supabase.createClient){
  document.addEventListener('DOMContentLoaded', ()=>{ document.body.innerHTML = '<p style="font:16px sans-serif;padding:24px">Bağlantı kitaplığı yüklenemedi (internet / reklam engelleyici). Sayfayı yenileyin.</p>'; });
  return;
}
const sb = window.supabase.createClient(CFG.url, CFG.key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'fs-auth-v2' }
});
window.fsSupabase = sb;
const realFetch = window.fetch.bind(window);

// ---------- yardımcılar ----------
function respond(body){
  const text = (typeof body === 'string') ? body : JSON.stringify(body);
  return new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } });
}
function withAbort(promise, signal){
  if(!signal) return promise;
  return new Promise((resolve, reject)=>{
    const onAbort = ()=>reject(new DOMException('Aborted', 'AbortError'));
    if(signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject);
  });
}
async function callApi(action, params){
  const { data, error } = await sb.rpc('api', { p_action: action, p: params || {} });
  if(error){
    if(error.code === 'PGRST301' || /JWT|token/i.test(error.message || '')) return { ok: false, error: 'unauthorized' };
    throw new TypeError('Sunucu hatası: ' + (error.message || error.code));
  }
  return data;
}

// ---------- toplu veri: yalnız değiştiyse indir ----------
let bulkCache = null;
async function bulk(){
  let rev = null;
  try{ const r = await callApi('rev'); rev = r && r.rev; }catch(e){ /* sürüm sorulamazsa doğrudan indir */ }
  if(rev && bulkCache && bulkCache.rev === rev) return bulkCache.text;
  const data = await callApi('bulk');
  const text = JSON.stringify(data);
  if(rev && data && !data.error) bulkCache = { rev, text };
  return text;
}

// ---------- görseller: base64 yerine Storage ----------
async function uploadDataUrl(dataUrl, folder){
  const m = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl || '');
  if(!m) return dataUrl;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = /png/.test(m[1]) ? 'png' : (/webp/.test(m[1]) ? 'webp' : 'jpg');
  const path = folder + '/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + '.' + ext;
  const { error } = await sb.storage.from(CFG.bucket).upload(path, bytes, { contentType: m[1], upsert: true, cacheControl: '31536000' });
  if(error) throw new Error('Görsel yüklenemedi: ' + error.message);
  return sb.storage.from(CFG.bucket).getPublicUrl(path).data.publicUrl;
}
async function mapLimit(items, limit, fn){
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async ()=>{
    while(i < items.length){ const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// ---------- bildirim ve yönetici silme onayları ----------
window.fsUser = null;
function notify(msg){
  let el = document.getElementById('fs-notify');
  if(!el){
    el = document.createElement('div'); el.id = 'fs-notify';
    el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:200001;background:#92400e;color:#fff;padding:12px 20px;border-radius:12px;font:600 15px Inter,system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35);max-width:92vw;text-align:center';
    document.body.appendChild(el);
  }
  el.textContent = msg; el.style.display = 'block';
  clearTimeout(el._t); el._t = setTimeout(()=>{ el.style.display = 'none'; }, 7000);
}
let delBtn = null;
async function refreshDeletionBadge(){
  if(!window.fsUser || window.fsUser.role !== 'admin') return;
  let r; try{ r = await callApi('listDeletionRequests', {}); }catch(e){ return; }
  const n = (r && r.requests) ? r.requests.length : 0;
  if(!delBtn){
    delBtn = document.createElement('button');
    delBtn.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:99998;background:#b45309;color:#fff;border:0;border-radius:999px;padding:10px 16px;font:600 14px Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.3)';
    delBtn.onclick = openDeletionRequests;
    document.body.appendChild(delBtn);
  }
  delBtn.textContent = '🗑 Silme talepleri (' + n + ')';
  delBtn.style.display = n > 0 ? 'block' : 'none';
}
async function openDeletionRequests(){
  const r = await callApi('listDeletionRequests', {});
  const list = (r && r.requests) || [];
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:200000;display:flex;align-items:center;justify-content:center;font-family:Inter,system-ui,sans-serif';
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  wrap.innerHTML = '<div style="background:#fff;border-radius:14px;padding:20px;width:min(94vw,640px);max-height:84vh;overflow:auto"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0">Bekleyen silme talepleri</h3><button id="fs-del-close" style="border:0;background:none;font-size:22px;cursor:pointer">×</button></div>' +
    (list.length ? list.map(x => '<div style="border:1px solid #ddd;border-radius:10px;padding:10px;margin-bottom:8px"><div style="font-weight:600">' + esc(x.label) + '</div><div style="color:#666;font-size:12px;margin:2px 0 8px">' + esc(x.requestedBy) + ' · ' + esc((x.requestedAt || '').replace('T', ' ').slice(0, 16)) + ' · ' + esc(x.table) + '</div>' +
      '<button data-ok="1" data-id="' + x.id + '" style="background:#b91c1c;color:#fff;border:0;border-radius:8px;padding:8px 14px;cursor:pointer;margin-right:8px">Silmeyi onayla</button><button data-ok="0" data-id="' + x.id + '" style="background:#e5e7eb;border:0;border-radius:8px;padding:8px 14px;cursor:pointer">Reddet</button></div>').join('') : '<p>Bekleyen talep yok.</p>') + '</div>';
  document.body.appendChild(wrap);
  wrap.querySelector('#fs-del-close').onclick = ()=>wrap.remove();
  wrap.querySelectorAll('button[data-id]').forEach(b => b.onclick = async ()=>{
    b.disabled = true;
    const res = await callApi('decideDeletion', { requestId: b.dataset.id, approve: b.dataset.ok === '1' });
    if(!res || !res.ok){ window.alert('İşlem yapılamadı: ' + ((res && res.message) || (res && res.error) || 'bilinmeyen hata')); b.disabled = false; return; }
    wrap.remove(); bulkCache = null;
    await refreshDeletionBadge();
    if(typeof window.refreshData === 'function') window.refreshData(); else location.reload();
  });
}
setInterval(refreshDeletionBadge, 60000);

// ---------- oturum ----------
async function doLogin(b){
  const email = String(b.username || '').trim();
  const pw = String(b.passwordHash || '');
  if(pw){
    const { error } = await sb.auth.signInWithPassword({ email, password: pw });
    if(error) return { ok: false, error: 'invalid_credentials' };
  } else {
    const { data } = await sb.auth.getSession();
    if(!data || !data.session) return { ok: false, error: 'invalid_credentials' };
  }
  const r = await callApi('login', {});
  if(r && r.ok){ bulkCache = null; window.fsUser = r.user; setTimeout(refreshDeletionBadge, 1500); return r; }
  if(pw) await sb.auth.signOut();
  return { ok: false, error: (r && r.error === 'unauthorized') ? 'no_profile' : ((r && r.error) || 'invalid_credentials') };
}
async function doChangePassword(b){
  const np = String(b.newPasswordHash || '');
  if(np.length < 6) return { ok: false, error: 'weak_password', message: 'Parola en az 6 karakter olmalı' };
  const { error } = await sb.auth.updateUser({ password: np });
  return error ? { ok: false, error: 'failed', message: error.message } : { ok: true };
}
async function haveSession(){
  const { data } = await sb.auth.getSession();
  return !!(data && data.session);
}

// ---------- kur (TCMB sunucudan; olmazsa açık kaynak) ----------
let rateCache = null;
async function tcmbRate(){
  try{
    const r = await callApi('tcmbRate', {});
    if(r && r.ok) return r;
  }catch(e){}
  if(rateCache && rateCache.at > Date.now() - 6 * 3600 * 1000) return rateCache.v;
  try{
    const res = await realFetch('https://open.er-api.com/v6/latest/USD');
    const j = await res.json();
    if(j && j.rates && j.rates.TRY){
      const v = { ok: true, rate: j.rates.TRY, date: new Date().toISOString().slice(0, 10), source: 'open.er-api.com' };
      rateCache = { at: Date.now(), v };
      return v;
    }
  }catch(e){}
  return { ok: false, error: 'rate_unavailable' };
}

// ---------- istek yönlendirme ----------
async function handleGet(u){
  const q = u.searchParams;
  const action = q.get('action');
  const key = q.get('key');
  if(action === 'bootstrapStatus') return { hasUsers: true };
  if(action === 'publicLogo'){
    const { data, error } = await sb.rpc('a_publiclogo', { p: {} });
    return error ? { logo: null } : data;
  }
  if(action === 'tcmbRate') return await tcmbRate();
  if(!await haveSession()) return { ok: false, error: 'unauthorized' };
  if(!action && key){
    const v = await callApi('getKey', { key });
    return v;
  }
  if(!action) return { __raw: await bulk() };
  const params = {};
  q.forEach((v, k)=>{ if(k !== 'action' && k !== 'authUser' && k !== 'authHash') params[k] = v; });
  return await callApi(action, params);
}
async function handlePost(body){
  const a = body.action;
  if(a === 'login') return await doLogin(body);
  if(a === 'changePassword') return await doChangePassword(body);
  if(!await haveSession()) return { ok: false, error: 'unauthorized' };
  bulkCache = null;
  if(!a && Object.prototype.hasOwnProperty.call(body, 'key')){
    let value = body.value;
    if(String(body.key).indexOf('catalogVariant:') === 0 && value && typeof value.image === 'string' && value.image.indexOf('data:') === 0){
      value = Object.assign({}, value, { image: await uploadDataUrl(value.image, 'v') });
    }
    return await callApi('putKey', { key: body.key, value });
  }
  if(a === 'bulkSetVariantImages'){
    const images = await mapLimit(body.images || [], 4, async (im)=>({
      variantId: im.variantId,
      image: (typeof im.image === 'string' && im.image.indexOf('data:') === 0) ? await uploadDataUrl(im.image, 'v') : im.image
    }));
    return await callApi(a, Object.assign({}, body, { images, auth: undefined }));
  }
  const params = Object.assign({}, body); delete params.auth; delete params.action;
  return await callApi(a, params);
}

window.fetch = function(input, init){
  const url = (typeof input === 'string') ? input : (input && input.url) || '';
  if(url.indexOf('fsapi://') !== 0) return realFetch(input, init);
  init = init || {};
  const work = (async ()=>{
    let result;
    if(String(init.method || 'GET').toUpperCase() === 'POST'){
      let body = {};
      try{ body = JSON.parse(init.body || '{}'); }catch(e){}
      result = await handlePost(body);
    } else {
      result = await handleGet(new URL(url));
    }
    if(result && typeof result === 'object' && result.error === 'approval_required') notify(result.message || 'Silme işlemi yönetici onayına gönderildi.');
    if(result && typeof result === 'object' && typeof result.__raw === 'string') return respond(result.__raw);
    return respond(result === undefined ? null : result);
  })();
  return withAbort(work, init.signal);
};

// ---------- çıkış / parola sıfırlama ----------
window.fsSignOut = async function(){ bulkCache = null; window.fsUser = null; try{ await sb.auth.signOut(); }catch(e){} };
window.fsForgotPassword = async function(){
  const input = document.getElementById('lg-username');
  let email = (input && input.value || '').trim();
  if(!email) email = (window.prompt('Parola sıfırlama bağlantısı için e-posta adresinizi yazın:') || '').trim();
  if(!email) return;
  const redirectTo = location.origin + location.pathname;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
  window.alert(error ? ('Gönderilemedi: ' + error.message) : ('Bağlantı ' + email + ' adresine gönderildi (birkaç dakika sürebilir; gelen kutusu ve istenmeyen klasörüne bakın).'));
};
sb.auth.onAuthStateChange((event)=>{
  if(event !== 'PASSWORD_RECOVERY') return;
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:200000;display:flex;align-items:center;justify-content:center;font-family:Inter,system-ui,sans-serif';
  wrap.innerHTML = '<div style="background:#fff;border-radius:14px;padding:24px;width:min(92vw,360px);box-shadow:0 10px 40px rgba(0,0,0,.35)">' +
    '<h3 style="margin:0 0 6px">Yeni parola belirleyin</h3><p style="margin:0 0 12px;color:#666;font-size:13px">En az 8 karakter.</p>' +
    '<input id="fs-newpw" type="password" autocomplete="new-password" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;font-size:15px;box-sizing:border-box">' +
    '<div id="fs-newpw-msg" style="color:#b00020;font-size:13px;min-height:18px;margin-top:6px"></div>' +
    '<button id="fs-newpw-ok" style="margin-top:6px;width:100%;padding:11px;border:0;border-radius:8px;background:#232C2A;color:#fff;font-size:15px;cursor:pointer">Kaydet</button></div>';
  document.body.appendChild(wrap);
  document.getElementById('fs-newpw-ok').onclick = async ()=>{
    const pw = document.getElementById('fs-newpw').value;
    const msg = document.getElementById('fs-newpw-msg');
    if(pw.length < 8){ msg.textContent = 'Parola en az 8 karakter olmalı'; return; }
    const { error } = await sb.auth.updateUser({ password: pw });
    if(error){ msg.textContent = error.message; return; }
    wrap.remove();
    window.alert('Parolanız güncellendi.');
    location.href = location.origin + location.pathname;
  };
});

// ---------- "deneme sürümü" etiketi (geçişte kaldırılır) ----------
document.addEventListener('DOMContentLoaded', ()=>{
  if(window.FS_HIDE_BADGE) return;
  const b = document.createElement('div');
  b.textContent = 'YENİ SİSTEM · deneme';
  b.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;background:#0f766e;color:#fff;font:600 11px Inter,system-ui,sans-serif;padding:4px 9px;border-radius:999px;opacity:.85;pointer-events:none';
  document.body.appendChild(b);
});
})();

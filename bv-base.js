
// Base: theme + year
const $ = (s)=>document.querySelector(s); const $$=(s)=>Array.from(document.querySelectorAll(s));
function setTheme(d){const c=document.documentElement.classList; d?c.add('dark'):c.remove('dark'); localStorage.setItem('theme', d?'dark':'light');}
setTheme((localStorage.getItem('theme')||'')==='dark' || window.matchMedia('(prefers-color-scheme: dark)').matches);
$('#themeToggle')?.addEventListener('click',()=>setTheme(!document.documentElement.classList.contains('dark')));
$('#year') && ($('#year').textContent=new Date().getFullYear());

// === Produktdaten ===
window.ITEMS = [
  { id:'zelt_4x12', cat:'zelt',   name:'Party-Zelt 4×12 m',  day:80, weekend:100, deposit:150, img:'assets/zelt-4x12.jpg', desc:'Seitenwände inkl., solide Plane' },
  { id:'zelt_4x6',  cat:'zelt',   name:'Party-Zelt 4×6 m',   day:30, weekend:35, deposit:100, img:'assets/zelt-4x6.jpg',  desc:'Seitenwände inkl., ideal für kleinere Feiern' },
  { id:'garnitur_70x220', cat:'moebel', name:'Bierzeltgarnitur 70×220 cm (Tisch + 2 Bänke)', day:10, weekend:12, deposit:30, img:'assets/garnitur-70x220.jpg', desc:'Für 6–8 Personen, robuste Ausführung' },
  { id:'stehtisch_70', cat:'moebel', name:'Stehtisch Ø70 cm', day:5, weekend:7, deposit:20, img:'assets/stehtisch-70.jpg', desc:'Klapptisch, Husse optional' }
];

// --- Merge Admin LocalStorage products into window.ITEMS (so all pages know Admin IDs) ---
function bvNormalizeProducts(arr){
  return (arr||[]).map((p, idx)=>{
    const id = String(p.id ?? p.slug ?? p.key ?? (p.name||('item_'+idx))).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
    const day = Number(p.pricePerDay ?? p.day ?? 0);
    return {
      id,
      cat: p.category ?? p.cat ?? 'katalog',
      name: p.name ?? ('Artikel '+(idx+1)),
      day,
      weekend: Number(p.weekend ?? Math.round(day*2.2)),
      deposit: Number(p.deposit ?? 0),
      img: p.image ?? p.img ?? '',
      desc: p.description ?? p.desc ?? ''
    };
  });
}
function bvMergeItems(a,b){
  const map = new Map();
  (a||[]).forEach(it=>{ if(it?.id) map.set(it.id, it); });
  (b||[]).forEach(it=>{ if(it?.id) map.set(it.id, it); });
  return Array.from(map.values());
}
function bvLoadAdminLS(){
  const keys = ['bv_admin_products','products','items','bv_products','benson_products'];
  for(const key of keys){
    try{
      const raw = localStorage.getItem(key);
      if(!raw) continue;
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : (Array.isArray(parsed?.data)? parsed.data : []));
      const norm = bvNormalizeProducts(arr);
      if(norm.length) return norm;
    }catch(e){}
  }
  return [];
}
// Merge once at startup
(function(){ try{ const extra = bvLoadAdminLS(); if(extra.length){ window.ITEMS = bvMergeItems(window.ITEMS, extra); } }catch(e){} })();


// === Katalog-Index ===
let CATALOG_INDEX = {};
function rebuildIndex(){ CATALOG_INDEX = {}; (window.ITEMS||[]).forEach(it => { if (it && it.id) CATALOG_INDEX[it.id] = it; }); }
function getItem(id){ return CATALOG_INDEX[id] || null; }
rebuildIndex();

// === Utils ===
const EUR = n => '€' + (Number(n)||0).toFixed(2).replace('.', ',');
function parseDate(id){ const el=document.getElementById(id); if(!el||!el.value) return null; const d=new Date(el.value + 'T00:00:00'); return isNaN(d)?null:d; }
function rentalDays(){ const a=parseDate('fromDate'), b=parseDate('toDate'); if(!a||!b) return 1; const ms=b-a; if(ms<0) return 1; return Math.max(1, Math.floor(ms/86400000)+1); }
function deliveryCost(){ const mode=document.getElementById('delivery')?.value||'pickup'; if (mode!=='delivery') return 0; const km=parseFloat(document.getElementById('kmInput')?.value||'0')||0; const back=document.getElementById('returnTrip')?.checked?2:1; return km*0.45*back; }

// === Cart mit Persistenz ===
const cart = new Map();
function loadCart(){
  try {
    const raw = localStorage.getItem('bv_cart');
    if(!raw) return;
    const obj = JSON.parse(raw);
    Object.entries(obj).forEach(([id,qty])=>{
      if (qty>0) cart.set(id, qty); // accept even if product not known yet
    });
  }catch(e){}

}
function saveCart(){
  const obj = {};
  for (const [id,qty] of cart.entries()){ obj[id]=qty; }
  localStorage.setItem('bv_cart', JSON.stringify(obj));
}
function sumCartItems(){
  const days = rentalDays();
  let items = 0, deposit = 0;
  for (const [id, qty] of cart.entries()){
    const it = getItem(id);
    if (!it) continue;
    items   += (Number(it.day)||0)     * (qty||0) * days;
    deposit += (Number(it.deposit)||0) * (qty||0);
  }
  return {items, deposit, days};
}
function updateHiddenInputs(){
  const payload = Array.from(cart.entries()).map(([id,qty])=>({id,qty}));
  document.getElementById('cartInput')?.setAttribute('value', JSON.stringify(payload));
  const {items} = sumCartItems();
  document.getElementById('totalInput')?.setAttribute('value', (items + deliveryCost()).toFixed(2));
}
function updateBadge(){
  const badge=document.getElementById('cartCountBadge');
  const n = cart.size;
  if(badge){
    if(n>0){ badge.textContent=n; badge.style.display='inline-block'; }
    else { badge.textContent='0'; badge.style.display='none'; }
    const btn=document.getElementById('miniCartToggle'); if(btn) btn.setAttribute('aria-label','Warenkorb ('+n+')');
  }
}
function renderMiniList(){
  const ul = document.getElementById('miniCartList');
  if (!ul) return;
  if (cart.size === 0){ ul.innerHTML = '<li>Noch keine Artikel ausgewählt.</li>'; return; }
  const days = rentalDays();
  ul.innerHTML = Array.from(cart.entries()).map(([id, qty]) => {
    const p = getItem(id); if(!p) return '';
    const line = (Number(p.day)||0) * (qty||0) * days;
    return `
      <li class="py-2 flex items-center gap-3" data-id="${id}" data-qty="${qty}">
        <div class="flex-1">
          <div class="font-medium leading-tight">${p.name}</div>
          <div class="text-xs text-slate-500">${qty}× ${EUR(p.day)} /Tag × ${days} Tage = <strong>${EUR(line)}</strong></div>
        </div>
        <div class="flex items-center gap-2">
          <button class="px-2 py-1 rounded border" data-dec="${id}" aria-label="${p.name} verringern">−</button>
          <input type="number" min="0" class="w-16 rounded border px-2 py-1 qty" value="${qty}" data-q="${id}" aria-label="${p.name} Anzahl">
          <button class="px-2 py-1 rounded border" data-inc="${id}" aria-label="${p.name} erhöhen">+</button>
          <button class="px-2 py-1 rounded border text-red-600" data-del="${id}" aria-label="${p.name} entfernen">×</button>
        </div>
      </li>`;
  }).join('');
  ul.querySelectorAll('[data-dec]').forEach(b => b.onclick = ()=> changeQty(b.dataset.dec, (cart.get(b.dataset.dec)||0) - 1));
  ul.querySelectorAll('[data-inc]').forEach(b => b.onclick = ()=> changeQty(b.dataset.inc, (cart.get(b.dataset.inc)||0) + 1));
  ul.querySelectorAll('[data-del]').forEach(b => b.onclick = ()=> changeQty(b.dataset.del, 0));
  ul.querySelectorAll('[data-q]').forEach(inp => inp.onchange = ()=> changeQty(inp.dataset.q, parseInt(inp.value||'0',10) || 0));
}
function renderMainList(){
  const list=document.getElementById('cartList');
  if (!list) return;
  if (cart.size===0){ list.innerHTML='<li>Noch keine Artikel ausgewählt.</li>'; return; }
  const days = rentalDays();
  list.innerHTML = Array.from(cart.entries()).map(([id,qty])=>{
    const p=getItem(id); if(!p) return '';
    const line=(Number(p.day)||0)*(qty||0)*days;
    return `<li>${qty}× ${p.name} — ${EUR(p.day)}/Tag × ${days} Tage = <strong>${EUR(line)}</strong></li>`;
  }).join('');
}
function updateEstimatesUI(){
  const {items, deposit} = sumCartItems();
  const del = deliveryCost();
  const total = items + del;
  document.getElementById('miniTotal') && (document.getElementById('miniTotal').textContent = EUR(total) + (deposit?(' (zzgl. Kaution ca. '+EUR(deposit)+')'):''));
  const sideEst = document.getElementById('estimate');
  if (sideEst) sideEst.textContent = EUR(total) + (deposit?(' (zzgl. Kaution ca. '+EUR(deposit)+')'):'');
  updateHiddenInputs();
}
function changeQty(id, next){
  next = Math.max(0, next|0);
  if (next === 0) cart.delete(id); else cart.set(id, next);
  saveCart();
  syncAll();
}
function addToCart(id, qty){
  cart.set(id, (cart.get(id)||0) + qty);
  saveCart();
  syncAll();
}
function syncAll(){
  renderMiniList();
  renderMainList();
  updateBadge();
  updateEstimatesUI();
}

// Globaler Add-Handler (Delegation, falls Buttons ohne Bindung vorhanden)
document.addEventListener('click',(e)=>{
  const btn=e.target.closest?.('.addBtn');
  if(!btn) return;
  const id=btn.getAttribute('data-id');
  const qtyInput=btn.closest('div')?.querySelector('input[type="number"]');
  const qty=Math.max(1, parseInt(qtyInput?.value||'1',10));
  addToCart(id, qty);
});

// Toggle Mini Panel
(function(){
  const btn = document.getElementById('miniCartToggle');
  const panel = document.getElementById('miniCartPanel');
  const root = document.getElementById('miniCartTopRight');
  if(btn && panel && root && !btn.__bvBound){
    btn.__bvBound = true;
    btn.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); panel.classList.toggle('hidden'); });
    document.addEventListener('click', (e)=>{ if(!panel.classList.contains('hidden') && !root.contains(e.target)) panel.classList.add('hidden'); });
  }
})();

// Live-Recalc for estimation inputs
;['fromDate','toDate','delivery','kmInput','returnTrip'].forEach(id=>{
  const el = document.getElementById(id);
  if (el){
    const evt = (el.type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input';
    el.addEventListener(evt, ()=> { syncAll(); });
  }
});

// Toggle delivery extras
document.getElementById('delivery')?.addEventListener('change', (e)=>{
  const extras = document.getElementById('deliveryExtras');
  if (!extras) return;
  if (e.target.value === 'delivery') extras.classList.remove('hidden'); else extras.classList.add('hidden');
});

// Init
loadCart();
syncAll();

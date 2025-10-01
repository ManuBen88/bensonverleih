
let catalogGrid=document.getElementById('catalogGrid');
function money(n){ return '€' + (Number(n)||0).toFixed(2).replace('.', ','); }
function cardImageHTML(item){
  const alt = item.name || 'Artikel';
  if (item.img){
    return `<img src="${item.img}" alt="${alt}" class="w-full h-40 object-cover" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'w-full h-40 img-fallback',innerHTML:'<span>'+alt+'</span>'}))">`;
  }
  return `<div class="w-full h-40 img-fallback"><span>${alt}</span></div>`;
}
function bindAddButtons(scope){
  scope.querySelectorAll('.addBtn').forEach(btn=>{
    btn.addEventListener('click',(ev)=>{
      ev.preventDefault();
      const id=btn.getAttribute('data-id');
      const qtyInput=btn.closest('div').querySelector('input[type="number"]');
      const qty=Math.max(1, parseInt(qtyInput?.value||'1',10));
      addToCart(id, qty);
    });
  });
}
function renderCatalog(){
  if (!catalogGrid) return;
  const itemsArr = (window.ITEMS||[]);
  const q=(document.getElementById('catalogSearch')?.value || '').toLowerCase();
  const cat=document.getElementById('catalogFilter')?.value || 'all';
  const filtered=itemsArr.filter(it=>{
    const inCat = cat==='all' || it.cat===cat;
    const txt=(it.name+' '+(it.desc||'')).toLowerCase();
    const inTxt=!q || txt.includes(q);
    return inCat && inTxt;
  });
  if(filtered.length===0){
    catalogGrid.innerHTML = `<div class="col-span-full text-center text-slate-500 py-8">Keine Artikel gefunden.</div>`;
    return;
  }
  catalogGrid.innerHTML=filtered.map(item=>`
    <div class="p-0 rounded-2xl border bg-white/60 dark:bg-slate-900/60 flex flex-col overflow-hidden">
      ${cardImageHTML(item)}
      <div class="p-6 flex-1">
        <div class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">${item.cat||'katalog'}</div>
        <h3 class="font-semibold text-lg mt-1">${item.name}</h3>
        <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">${item.desc||''}</p>
        <div class="mt-2 text-sm text-slate-600 dark:text-slate-300"><span class="font-semibold">${money(item.day)}</span>/Tag ${item.deposit?('· Kaution ca. '+money(item.deposit)) : ''}</div>
        <div class="mt-4 flex items-center gap-3">
          <input type="number" min="1" value="1" class="w-20 rounded-xl border px-3 py-2" aria-label="Menge" />
          <button type="button" class="px-4 py-2 rounded-xl bg-brand-600 text-white hover:bg-brand-700 font-semibold addBtn" data-id="${item.id}">Hinzufügen</button>
        </div>
      </div>
    </div>
  `).join('');
  bindAddButtons(catalogGrid);
}

async function loadProductsFromServer(){
  let ok=false;
  try{
    const r = await fetch('/admin/products', {cache:'no-store', credentials:'include'});
    if(!r.ok) return;
    const j = await r.json();
    const items = (j.items||[]).map((p, idx)=>{
      const id = String(p.id ?? p.slug ?? (p.name||'item_'+idx)).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
      const day = Number(p.pricePerDay)||0;
      return {
        id,
        cat: p.category || 'katalog',
        name: p.name || ('Artikel '+(idx+1)),
        day,
        weekend: Number(p.weekend)||Math.round(day*2.2),
        deposit: Number(p.deposit)||0,
        img: p.image || '',
        desc: p.description || ''
      };
    });
    if(items.length){ ok=true;
      window.ITEMS = items;
      if(typeof rebuildIndex === 'function') rebuildIndex();
      if(typeof syncAll === 'function') syncAll();
      renderCatalog();
    }
  }catch(err){ /* ignore */ }
  if(!ok){ await loadProductsFromLocalStorage(); }
}

function initCatalog(){
  renderCatalog();
  loadProductsFromServer();
}

window.addEventListener('DOMContentLoaded', ()=>{ initCatalog(); document.getElementById('catalogSearch')?.addEventListener('input', renderCatalog); document.getElementById('catalogFilter')?.addEventListener('change', renderCatalog); });

async function loadProductsFromLocalStorage(){
  try{
    const arr = JSON.parse(localStorage.getItem(LS_KEY_ADMIN)||'[]');
    if(Array.isArray(arr) && arr.length){
      const items = arr.map((p, idx)=>{
        const id = String(p.id ?? p.slug ?? (p.name||'item_'+idx)).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
        const day = Number(p.pricePerDay)||0;
        return {
          id,
          cat: p.category || 'katalog',
          name: p.name || ('Artikel '+(idx+1)),
          day,
          weekend: Number(p.weekend)||Math.round(day*2.2),
          deposit: Number(p.deposit)||0,
          img: p.image || '',
          desc: p.description || ''
        };
      });
      if(items.length){
        window.ITEMS = items;
        if(typeof rebuildIndex === 'function') rebuildIndex();
        if(typeof syncAll === 'function') syncAll();
        renderCatalog();
      }
    }
  }catch(e){ /* ignore */ }
}
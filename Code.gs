const ORDER_SHEET_NAME = 'Auftraege';
const ORDER_COLUMNS = [
  'orderId','status','createdAt','updatedAt','firstName','lastName','email','phone','fromDate','toDate','fromTime','toTime','street','zip','city','service','serviceLabel','cartJson','distanceKm','deliveryCost','laborCost','itemsSubtotal','total','calendarEventId','invoiceQueueId','invoiceStatus','invoiceNo','invoiceSentAt','notes','adminNotes','unknownItemsJson','manualTotal','manualTotalReason'
];
const ORDER_STATUSES = { request:'request', confirmed:'confirmed', declined:'declined', cancelled:'cancelled' };
const INVOICE_STATUSES = { none:'none', queued:'queued', sent:'sent', cancelled:'cancelled', error:'error' };
const MAX_QTY = 200;
const VAT_RATE = 0;
const TZ = 'Europe/Berlin';
const MIN_DELIVERY_ITEM_VALUE_LOCAL = 50;
const MIN_DELIVERY_ITEM_VALUE_OUTSIDE = 80;
const MIN_ALL_INCLUSIVE_ITEM_VALUE = 100;

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.admin !== undefined) return renderAdminPage_(p.admin || '');
  if (p.avail === '1') return ContentService.createTextOutput(JSON.stringify(handleAvail_(p))).setMimeType(ContentService.MimeType.JSON);
  if (p.confirm) return ContentService.createTextOutput(handleConfirm_(p.confirm));
  if (p.decline) return ContentService.createTextOutput(handleDecline_(p.decline));
  return ContentService.createTextOutput('OK');
}

function doPost(e) {
  try {
    const raw = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const clean = sanitizeOrderInput(raw);
    const order = recalculateOrderTotals(clean);
    enforceMinimumValueForPublicOrder_(order);
    order.orderId = generateOrderId_();
    order.status = ORDER_STATUSES.request;
    order.invoiceStatus = INVOICE_STATUSES.none;
    order.createdAt = new Date().toISOString();
    order.updatedAt = order.createdAt;
    saveOrder_(order);
    sendOwnerRequestMail_(order);
    return ContentService.createTextOutput(JSON.stringify({ ok:true, orderId: order.orderId })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return HtmlService.createHtmlOutput('<h3>Anfrage konnte nicht gesendet werden</h3><p>'+escapeHtml(err.message)+'</p>');
  }
}

function normalizeService(value){ const v=String(value||'').toLowerCase().trim().replace(/[\s-]+/g,'_'); if(/abholung|pickup|pick_up|selbstabholung/.test(v)) return 'abholung'; if(/lieferung|delivery/.test(v)) return 'lieferung'; if(/all_inclusive|allinclusive|aufbau|auf_und_abbau/.test(v)) return 'all_inclusive'; return 'abholung'; }
function serviceLabel(service){ const s=normalizeService(service); return s==='lieferung'?'Lieferung':(s==='all_inclusive'?'All-Inclusive':'Abholung'); }
function escapeHtml(value){ return String(value==null?'':value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function escapeAttr(value){ return escapeHtml(value).replace(/`/g,'&#96;'); }

function sanitizeOrderInput(raw){
  raw = raw || {};
  const service = normalizeService(raw.service);
  const itemMap = {}; getServerItems_().forEach(i=>itemMap[i.id]=i);
  const src = Array.isArray(raw.cart) ? raw.cart : safelyParseJson_(raw.cart, []);
  const cart = []; const unknownItems = [];
  src.forEach(x=>{ const id=String((x&&x.id)||'').trim(); const qty=Math.max(0,Math.min(MAX_QTY,parseInt((x&&x.qty)||0,10)||0)); if(!id||qty<1)return; if(!itemMap[id]) { unknownItems.push({id:id,qty:qty}); return; } cart.push({id:id,qty:qty}); });
  const fromDate = normalizeDate_(raw.fromDate), toDate=normalizeDate_(raw.toDate);
  if(!fromDate||!toDate||fromDate>toDate) throw new Error('Ungültiger Zeitraum.');
  return {
    orderId: safeText_(raw.orderId), firstName:safeText_(raw.firstName), lastName:safeText_(raw.lastName), email:sanitizeEmail_(raw.email), phone:safeText_(raw.phone),
    fromDate:fromDate, toDate:toDate, fromTime:safeText_(raw.fromTime), toTime:safeText_(raw.toTime), street:safeText_(raw.street), zip:safeText_(raw.zip), city:safeText_(raw.city),
    service:service, serviceLabel:serviceLabel(service), cart:cart, distanceKm:toNumber_(raw.distanceKm), deliveryCost:toNumber_(raw.deliveryCost), laborCost:toNumber_(raw.laborCost),
    notes:safeText_(raw.notes), adminNotes:safeText_(raw.adminNotes), unknownItems:unknownItems, manualTotal: raw.manualTotal===''||raw.manualTotal==null?'':toNumber_(raw.manualTotal), manualTotalReason:safeText_(raw.manualTotalReason)
  };
}

function recalculateOrderTotals(order){
  order = JSON.parse(JSON.stringify(order||{}));
  const map={}; getServerItems_().forEach(i=>map[i.id]=i);
  const days=rentalDays_(order.fromDate,order.toDate);
  let itemsSubtotal=0; (order.cart||[]).forEach(l=>{ const it=map[l.id]; if(it) itemsSubtotal += (Number(it.day)||0)*(Number(l.qty)||0)*days; });
  const service = normalizeService(order.service);
  let deliveryCost=Math.max(0,toNumber_(order.deliveryCost)); let laborCost=Math.max(0,toNumber_(order.laborCost));
  if(service==='abholung') deliveryCost=0;
  if(service==='all_inclusive') laborCost=calculateLaborCost_(order, itemsSubtotal);
  const total = (order.manualTotal!==''&&order.manualTotal!=null) ? Math.max(0,toNumber_(order.manualTotal)) : (itemsSubtotal+deliveryCost+laborCost);
  order.service=service; order.serviceLabel=serviceLabel(service); order.itemsSubtotal=round2_(itemsSubtotal); order.deliveryCost=round2_(deliveryCost); order.laborCost=round2_(laborCost); order.total=round2_(total);
  return order;
}

function recalculateQueuedInvoice(req){ return recalculateOrderTotals(req); }

function enforceMinimumValueForPublicOrder_(order){
  const service = normalizeService(order.service);
  if (service === 'abholung') return;
  const itemsSubtotal = toNumber_(order.itemsSubtotal);
  if (service === 'all_inclusive' && itemsSubtotal < MIN_ALL_INCLUSIVE_ITEM_VALUE) throw new Error('All-Inclusive lohnt sich erst ab 100 € Mietwert. Bitte füge weitere Artikel hinzu oder wähle Abholung.');
  if (service === 'lieferung') {
    if (isLocalCity_(order.city)) {
      if (itemsSubtotal < MIN_DELIVERY_ITEM_VALUE_LOCAL) throw new Error('Lieferung ist innerhalb Bienenbüttel erst ab 50 € Mietwert möglich. Bitte füge weitere Artikel hinzu oder wähle Abholung.');
    } else if (itemsSubtotal < MIN_DELIVERY_ITEM_VALUE_OUTSIDE) {
      throw new Error('Lieferung außerhalb Bienenbüttel ist erst ab 80 € Mietwert möglich. Bitte füge weitere Artikel hinzu oder wähle Abholung.');
    }
  }
}

function renderAdminPage_(token){
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN')||'';
  if (!expected || token !== expected) return HtmlService.createHtmlOutput('<h3>403 Zugriff verweigert</h3>');
  return HtmlService.createHtmlOutputFromFile('Admin').setTitle('BensonVerleihe Admin');
}
function requireAdmin_(token){ const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN')||''; if(!expected||token!==expected) throw new Error('Nicht autorisiert'); return true; }

function adminApi_listInvoiceQueue(adminToken){ requireAdmin_(adminToken); return admin_listInvoiceQueue(); }
function adminApi_getQueuedInvoice(queueId, adminToken){ requireAdmin_(adminToken); return admin_showQueuedReq(queueId); }
function adminApi_updateQueuedInvoice(queueId, patch, adminToken){ requireAdmin_(adminToken); return admin_patchQueuedInvoice(queueId, patch); }
function adminApi_deleteQueuedInvoice(queueId, adminToken){ requireAdmin_(adminToken); return admin_cancelQueuedInvoice(queueId); }
function adminApi_previewQueuedInvoice(queueId, adminToken){ requireAdmin_(adminToken); return admin_previewInvoiceForUid(queueId); }
function adminApi_sendQueuedInvoiceNow(queueId, adminToken){ requireAdmin_(adminToken); return admin_sendInvoiceNow(queueId); }
function adminApi_invoiceStatus(adminToken){ requireAdmin_(adminToken); return admin_invoiceStatus(); }
function adminApi_repairInvoiceSystem(adminToken){ requireAdmin_(adminToken); return admin_repairInvoiceSystem(); }

function admin_listInvoiceQueue(){
  const now = Date.now();
  const props = PropertiesService.getScriptProperties().getProperties();
  const queues = Object.keys(props).filter(k=>k.indexOf('invq:')===0).map(k=>{
    const q = safelyParseJson_(props[k], {});
    const o = getOrderByIdSafe_(q.orderId);
    const req = recalculateQueuedInvoice(o || {});
    return {
      queueId: (q.queueId || k.replace('invq:','')), orderId: q.orderId || '', customer: ((req.firstName||'')+' '+(req.lastName||'')).trim(), email: req.email||'',
      fromDate:req.fromDate||'', toDate:req.toDate||'', service:req.serviceLabel||serviceLabel(req.service), total:toNumber_(req.total),
      dueMs:toNumber_(q.sendAtMs), dueIso:toIso_(toNumber_(q.sendAtMs)), status: toNumber_(q.sendAtMs)<=now?'fällig':'wartet'
    };
  }).sort((a,b)=>a.dueMs-b.dueMs);
  const triggerCount = ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='invoiceRunner').length;
  return { queues: queues, triggerCount: triggerCount, runnerExists: triggerCount>0 };
}
function admin_showQueuedReq(uid){
  const raw = PropertiesService.getScriptProperties().getProperty('invq:'+uid);
  if(!raw) throw new Error('Queue nicht gefunden');
  const q=safelyParseJson_(raw,{}); const o = recalculateQueuedInvoice(getOrderById_(q.orderId));
  return { queueId: uid, queue: q, order: o };
}
function admin_patchQueuedInvoice(uid, patch){
  const key='invq:'+uid; const raw=PropertiesService.getScriptProperties().getProperty(key); if(!raw) throw new Error('Queue nicht gefunden');
  const q=safelyParseJson_(raw,{}); const old=getOrderById_(q.orderId);
  const merged = recalculateQueuedInvoice(Object.assign({}, old, sanitizeOrderInput(patch||{}), {orderId: old.orderId, status: old.status, invoiceStatus: old.invoiceStatus}));
  const warning = getMinimumValueWarning_(merged);
  merged.updatedAt = new Date().toISOString();
  saveOrder_(merged);
  q.sendAtMs = getInvoiceSendAtMs(merged); q.sendAtIso = toIso_(q.sendAtMs);
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(q));
  return {ok:true, warning:warning, queueId:uid};
}
function admin_previewInvoiceForUid(uid){
  const d = admin_showQueuedReq(uid);
  return buildInvoicePreview_(d.order, 'A2026-PREVIEW');
}
function admin_sendInvoiceNow(uid){
  const d=admin_showQueuedReq(uid); const o=d.order;
  if (!o.invoiceNo) o.invoiceNo = nextInvoiceNo_(true);
  sendInvoice_(o, false, o.invoiceNo);
  o.invoiceStatus = INVOICE_STATUSES.sent; o.invoiceSentAt=new Date().toISOString(); saveOrder_(o);
  PropertiesService.getScriptProperties().deleteProperty('invq:'+uid);
  return {ok:true, orderId:o.orderId, queueId:uid};
}
function admin_cancelQueuedInvoice(uid){
  const d=admin_showQueuedReq(uid);
  PropertiesService.getScriptProperties().deleteProperty('invq:'+uid);
  Logger.log('Queue gelöscht: '+uid+' / '+d.order.firstName+' '+d.order.lastName+' / '+d.order.fromDate+'-'+d.order.toDate);
  return {ok:true, queueId:uid};
}

function scheduleInvoiceFor(order){ if(!order||!order.orderId||order.status!==ORDER_STATUSES.confirmed) return; deleteInvoiceQueueForOrder_(order.orderId); const qid=Utilities.getUuid(); const sendAt=getInvoiceSendAtMs(order); PropertiesService.getScriptProperties().setProperty('invq:'+qid, JSON.stringify({queueId:qid,orderId:order.orderId,sendAtMs:sendAt,sendAtIso:toIso_(sendAt)})); order.invoiceQueueId=qid; order.invoiceStatus=INVOICE_STATUSES.queued; order.updatedAt=new Date().toISOString(); saveOrder_(order); ensureInvoiceRunnerTrigger(); }
function getInvoiceSendAtMs(order){ const d = new Date(order.toDate+'T09:00:00+02:00'); d.setDate(d.getDate()+1); return d.getTime(); }
function ensureInvoiceRunnerTrigger(){ const ts=ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='invoiceRunner'); ts.slice(1).forEach(t=>ScriptApp.deleteTrigger(t)); if(ts.length===0) ScriptApp.newTrigger('invoiceRunner').timeBased().everyHours(1).create(); }
function admin_repairInvoiceSystem(){ ensureInvoiceRunnerTrigger(); return admin_invoiceStatus(); }
function admin_invoiceStatus(){ const st=admin_listInvoiceQueue(); const due=st.queues.filter(q=>q.status==='fällig').length; const waiting=st.queues.length-due; return {triggerCount:st.triggerCount, runnerExists:st.runnerExists, queueCount:st.queues.length, dueCount:due, waitingCount:waiting}; }

function invoiceRunner(e){
  ensureInvoiceRunnerTrigger();
  const now=Date.now(); const props=PropertiesService.getScriptProperties().getProperties();
  Object.keys(props).filter(k=>k.indexOf('invq:')===0).forEach(k=>{
    try {
      const q=safelyParseJson_(props[k],null); if(!q||toNumber_(q.sendAtMs)>now) return;
      const o=getOrderByIdSafe_(q.orderId); if(!o||o.invoiceStatus===INVOICE_STATUSES.sent){ PropertiesService.getScriptProperties().deleteProperty(k); return; }
      if (!o.invoiceNo) o.invoiceNo = nextInvoiceNo_(true);
      sendInvoice_(o,false,o.invoiceNo);
      o.invoiceStatus=INVOICE_STATUSES.sent; o.invoiceSentAt=new Date().toISOString(); o.updatedAt=new Date().toISOString(); saveOrder_(o);
      PropertiesService.getScriptProperties().deleteProperty(k);
    } catch (err) { MailApp.sendEmail(Session.getActiveUser().getEmail(),'InvoiceRunner Fehler',String(err)); }
  });
}

function handleAvail_(p){ return {ok:true,from:p.from,to:p.to,blocked:listOrders_().filter(o=>o.status===ORDER_STATUSES.confirmed&&overlaps_(o.fromDate,o.toDate,p.from,p.to)).length}; }
function handleConfirm_(orderId){ const o=getOrderById_(orderId); o.status=ORDER_STATUSES.confirmed; o.updatedAt=new Date().toISOString(); saveOrder_(o); scheduleInvoiceFor(o); return 'Auftrag bestätigt'; }
function handleDecline_(orderId){ const o=getOrderById_(orderId); o.status=ORDER_STATUSES.declined; o.invoiceStatus=INVOICE_STATUSES.cancelled; o.updatedAt=new Date().toISOString(); saveOrder_(o); deleteInvoiceQueueForOrder_(orderId); return 'Auftrag abgelehnt'; }

function buildInvoicePreview_(order, previewNo){
  const invoiceNo = previewNo || order.invoiceNo || 'BV-UNSET';
  const lines = ['Rechnungsnr: '+invoiceNo, 'Service: '+serviceLabel(order.service), 'Artikel: '+toNumber_(order.itemsSubtotal).toFixed(2)+' €'];
  if (normalizeService(order.service)!=='abholung' && toNumber_(order.deliveryCost)>0) lines.push('Lieferkosten: '+toNumber_(order.deliveryCost).toFixed(2)+' €');
  if (toNumber_(order.laborCost)>0) lines.push('Lohnkosten: '+toNumber_(order.laborCost).toFixed(2)+' €');
  lines.push('Gesamt: '+toNumber_(order.total).toFixed(2)+' €');
  if (VAT_RATE===0) lines.push('Hinweis: Gemäß §19 UStG wird keine Umsatzsteuer berechnet.');
  return lines.join('\n');
}
function sendInvoice_(order, manual, invoiceNo){ const body=buildInvoicePreview_(order, invoiceNo); const owner=Session.getActiveUser().getEmail(); MailApp.sendEmail(owner,'Rechnung '+order.orderId,body); if(!manual && order.email) MailApp.sendEmail(order.email,'Ihre Rechnung '+order.orderId,body); }
function sendOwnerRequestMail_(order){ MailApp.sendEmail(Session.getActiveUser().getEmail(),'Neue Anfrage '+order.orderId,'Bitte bestätigen: ?confirm='+order.orderId+'\nOder ablehnen: ?decline='+order.orderId); }

function getServerItems_(){ return [{id:'zelt_4x12',day:80},{id:'zelt_4x6',day:30},{id:'garnitur_70x220',day:10},{id:'stehtisch_70',day:5}]; }
function getOrdersSheet_(){ const props=PropertiesService.getScriptProperties(); let id=props.getProperty('ORDERS_SHEET_ID'); let ss=null; if(id){ ss=SpreadsheetApp.openById(id); } else { try{ss=SpreadsheetApp.getActiveSpreadsheet();}catch(e){ss=null;} if(!ss) ss=SpreadsheetApp.create('BensonVerleihe-Auftraege'); props.setProperty('ORDERS_SHEET_ID', ss.getId()); } let sh=ss.getSheetByName(ORDER_SHEET_NAME); if(!sh){ sh=ss.insertSheet(ORDER_SHEET_NAME); sh.appendRow(ORDER_COLUMNS); } return sh; }
function saveOrder_(order){ const sh=getOrdersSheet_(); const data=sh.getDataRange().getValues(); const idx=data.findIndex((r,i)=>i>0&&r[0]===order.orderId); const row=ORDER_COLUMNS.map(c=>c==='cartJson'?JSON.stringify(order.cart||[]):c==='unknownItemsJson'?JSON.stringify(order.unknownItems||[]):(order[c]||'')); if(idx>0) sh.getRange(idx+1,1,1,row.length).setValues([row]); else sh.appendRow(row); }
function listOrders_(){ const rows=getOrdersSheet_().getDataRange().getValues(); return rows.slice(1).map(r=>rowToOrder_(r)); }
function getOrderById_(id){ const o=listOrders_().find(x=>x.orderId===id); if(!o) throw new Error('Auftrag nicht gefunden'); return o; }
function getOrderByIdSafe_(id){ try { return getOrderById_(id); } catch(e) { return null; } }
function rowToOrder_(r){ const o={}; ORDER_COLUMNS.forEach((c,i)=>o[c]=r[i]); o.cart=safelyParseJson_(o.cartJson,[]); o.unknownItems=safelyParseJson_(o.unknownItemsJson,[]); return recalculateOrderTotals(o); }
function deleteInvoiceQueueForOrder_(orderId){ const p=PropertiesService.getScriptProperties(); const all=p.getProperties(); Object.keys(all).filter(k=>k.indexOf('invq:')===0).forEach(k=>{ const q=safelyParseJson_(all[k],null); if(q&&q.orderId===orderId) p.deleteProperty(k); }); }

function getMinimumValueWarning_(order){ try{ enforceMinimumValueForPublicOrder_(order); return ''; }catch(e){ return e.message; } }
function isLocalCity_(city){ const s=String(city||'').toLowerCase(); return s.indexOf('bienenbüttel')>=0 || s.indexOf('29553 bienenbüttel')>=0; }
function calculateLaborCost_(order, itemsSubtotal){ return round2_(Math.max(0, rentalDays_(order.fromDate,order.toDate)*25)); }
function generateOrderId_(){ return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss')+'-'+Math.floor(Math.random()*1000); }
function normalizeDate_(v){ const s=String(v||'').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:''; }
function sanitizeEmail_(v){ const s=String(v||'').trim(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)?s:''; }
function safeText_(v){ return String(v==null?'':v).replace(/[<>]/g,'').trim().slice(0,500); }
function toNumber_(v){ const n=Number(v); return isFinite(n)?n:0; }
function round2_(n){ return Math.round((Number(n)||0)*100)/100; }
function safelyParseJson_(s,fallback){ try{return JSON.parse(s);}catch(e){return fallback;} }
function rentalDays_(from,to){ const a=new Date(from+'T00:00:00'); const b=new Date(to+'T00:00:00'); return Math.max(1, Math.floor((b-a)/86400000)+1); }
function overlaps_(a1,a2,b1,b2){ return !(a2 < b1 || a1 > b2); }
function toIso_(ms){ if(!ms) return ''; return Utilities.formatDate(new Date(ms), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"); }
function nextInvoiceNo_(commit){ const p=PropertiesService.getScriptProperties(); const k='INVOICE_SEQ'; const n=(parseInt(p.getProperty(k)||'1000',10)||1000)+1; if(commit) p.setProperty(k, String(n)); return 'BV-'+n; }

function admin_createDueTestInvoice(adminToken){ requireAdmin_(adminToken); const o = recalculateOrderTotals({firstName:'TEST',lastName:'Intern',email:'',phone:'',fromDate:'2026-01-01',toDate:'2026-01-01',fromTime:'10:00',toTime:'12:00',street:'',zip:'',city:'Bienenbüttel',service:'abholung',cart:[{id:getServerItems_()[0].id,qty:1}],deliveryCost:0,laborCost:0}); o.orderId=generateOrderId_(); o.status=ORDER_STATUSES.confirmed; o.invoiceStatus=INVOICE_STATUSES.queued; o.createdAt=new Date().toISOString(); o.updatedAt=o.createdAt; saveOrder_(o); scheduleInvoiceFor(o); return {ok:true, orderId:o.orderId}; }

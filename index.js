const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json());

const MOF_API = 'https://einvoice.nat.gov.tw/PB2CAPIVAN/invapp/InvApp';
const APP_ID = 'EINV_APP_001';
const API_KEY = 'CloudInvoice';

function aesEncrypt(text, key) {
  const k = Buffer.from(key.padEnd(16,'0').slice(0,16));
  const iv = Buffer.from(key.padEnd(16,'0').slice(0,16));
  const c = crypto.createCipheriv('aes-128-cbc', k, iv);
  c.setAutoPadding(true);
  return c.update(text,'utf8','base64') + c.final('base64');
}

function getTimeStamp() { return Math.floor(Date.now()/1000).toString(); }

function getTodayDate() {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}
function getStartDate() {
  const d = new Date(); d.setMonth(d.getMonth()-1);
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}
function formatDate(str) {
  if (!str) return '';
  if (/^\d{7}$/.test(str)) { const y=parseInt(str.slice(0,3))+1911; return `${y}-${str.slice(3,5)}-${str.slice(5,7)}`; }
  return str.replace(/\//g,'-');
}

function guessCategory(name='') {
  const n=name.toLowerCase();
  if(/全聯|家樂福|大潤發|costco|好市多|頂好|愛買/.test(n)) return '基礎飲食';
  if(/麥當勞|肯德基|摩斯|漢堡王|subway|鬍鬚張|吉野家|爭鮮/.test(n)) return '餐廳消費';
  if(/星巴克|starbucks|路易莎|cama|85度|清心|50嵐|一芳/.test(n)) return '飲料咖啡';
  if(/netflix|spotify|apple|google|youtube|disney|line/.test(n)) return '訂閱費';
  if(/中華電信|台灣大哥大|遠傳|台哥大|亞太/.test(n)) return '電信費';
  if(/捷運|公車|台鐵|高鐵|客運/.test(n)) return '大眾運輸';
  if(/uber|計程車|taxi/.test(n)) return 'Uber/計程';
  if(/藥局|藥妝|屈臣氏|康是美|大樹/.test(n)) return '藥品';
  if(/健身|gym/.test(n)) return '健身房';
  if(/誠品|博客來|金石堂/.test(n)) return '書籍';
  if(/蝦皮|shopee|momo|pchome|yahoo/.test(n)) return '購物';
  if(/全家|7-eleven|萊爾富|ok超商/.test(n)) return '基礎飲食';
  if(/診所|醫院/.test(n)) return '看診';
  return '雜費';
}
function guessIcon(name='') {
  const n=name.toLowerCase();
  if(/全聯|家樂福|好市多/.test(n)) return '🛒';
  if(/麥當勞|肯德基|摩斯/.test(n)) return '🍔';
  if(/星巴克|路易莎|85度/.test(n)) return '☕';
  if(/netflix|disney/.test(n)) return '🎬';
  if(/spotify/.test(n)) return '🎵';
  if(/捷運|公車|台鐵/.test(n)) return '🚌';
  if(/uber|計程/.test(n)) return '🚗';
  if(/藥局|藥妝/.test(n)) return '💊';
  if(/健身|gym/.test(n)) return '🏋️';
  if(/蝦皮|momo|pchome/.test(n)) return '🛍️';
  if(/全家|7-eleven|萊爾富/.test(n)) return '🏪';
  if(/診所|醫院/.test(n)) return '🏥';
  return '🧾';
}

app.get('/', (req,res) => res.json({status:'ok',message:'記帳本後端運作中 ✓',version:'2.0'}));

app.post('/api/invoices', async (req,res) => {
  const {barcode, startDate, endDate} = req.body;
  if (!barcode) return res.status(400).json({error:'請提供手機條碼'});

  const timeStamp = getTimeStamp();
  const cardEncrypt = aesEncrypt(barcode, API_KEY);
  const start = startDate || getStartDate();
  const end = endDate || getTodayDate();

  try {
    const params = new URLSearchParams({
      version:'0.5', type:'Carrier', carrierId2:barcode,
      cardEncrypt, timeStamp, appID:APP_ID,
      action:'qryCarrierInv', startDate:start, endDate:end,
      onlyWinningInv:'N', uuid:crypto.randomUUID(),
    });
    console.log('MOF query:', barcode, start, '-', end);
    const response = await axios.post(MOF_API, params.toString(), {
      headers:{'Content-Type':'application/x-www-form-urlencoded'}, timeout:15000,
    });
    const data = response.data;
    console.log('MOF code:', data.code, 'details:', (data.details||[]).length);

    if (data.code !== 200 && data.code !== '200') {
      const msgs = {
        'INV114':'手機條碼驗證失敗',
        'INV115':'驗證碼錯誤',
        'INV116':'手機條碼不存在',
        'INV117':'查詢區間超過3個月限制',
        'INV106':'查無發票資料',
      };
      return res.status(400).json({error: msgs[data.code]||`財政部錯誤(${data.code})`, code:data.code});
    }

    const invoices = (data.details||[]).map(inv => ({
      no: inv.invNum||'',
      date: formatDate(inv.invDate),
      merchant: inv.sellerName||'未知商家',
      amount: parseInt(inv.amount)||0,
      category: guessCategory(inv.sellerName||''),
      icon: guessIcon(inv.sellerName||''),
    }));

    res.json({success:true, count:invoices.length, invoices});
  } catch(error) {
    console.error('Error:', error.message);
    res.status(500).json({error:'無法連線到財政部平台，請稍後再試'});
  }
});

app.post('/api/invoice-detail', async (req,res) => {
  const {invNum, invDate} = req.body;
  try {
    const params = new URLSearchParams({
      version:'0.5', type:'General', invNum,
      action:'qryInvDetail', generation:'V2',
      appID:APP_ID, uuid:crypto.randomUUID(),
    });
    const r = await axios.post(MOF_API, params.toString(), {
      headers:{'Content-Type':'application/x-www-form-urlencoded'}, timeout:10000,
    });
    const items = (r.data.details||[]).map(i => ({
      name:i.description||'', qty:parseFloat(i.quantity)||1,
      price:Math.round(parseFloat(i.unitPrice||0)*parseFloat(i.quantity||1)),
    }));
    res.json({success:true, items});
  } catch(e) { res.json({success:true, items:[]}); }
});

app.listen(PORT, () => console.log(`✓ 記帳本後端啟動，Port: ${PORT}`));
});

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

function getTodayDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return y+'/'+m+'/'+day;
}

function getStartDate() {
  const d = new Date();
  d.setMonth(d.getMonth()-1);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return y+'/'+m+'/'+day;
}

function formatDate(str) {
  if (!str) return '';
  if (/^\d{7}$/.test(str)) {
    const y = parseInt(str.slice(0,3)) + 1911;
    return y + '-' + str.slice(3,5) + '-' + str.slice(5,7);
  }
  return str.replace(/\//g,'-');
}

function guessCategory(name) {
  if (!name) return 'misc';
  const n = name;
  if (n.indexOf('全聯') >= 0 || n.indexOf('家樂福') >= 0 || n.indexOf('好市多') >= 0) return '基礎飲食';
  if (n.indexOf('麥當勞') >= 0 || n.indexOf('肯德基') >= 0 || n.indexOf('摩斯') >= 0) return '餐廳消費';
  if (n.indexOf('星巴克') >= 0 || n.indexOf('路易莎') >= 0 || n.indexOf('85度') >= 0) return '飲料咖啡';
  if (n.toLowerCase().indexOf('netflix') >= 0 || n.toLowerCase().indexOf('spotify') >= 0) return '訂閱費';
  if (n.indexOf('中華電信') >= 0 || n.indexOf('台灣大哥大') >= 0 || n.indexOf('遠傳') >= 0) return '電信費';
  if (n.indexOf('捷運') >= 0 || n.indexOf('公車') >= 0 || n.indexOf('台鐵') >= 0) return '大眾運輸';
  if (n.toLowerCase().indexOf('uber') >= 0 || n.indexOf('計程車') >= 0) return 'Uber/計程';
  if (n.indexOf('藥局') >= 0 || n.indexOf('藥妝') >= 0 || n.indexOf('屈臣氏') >= 0) return '藥品';
  if (n.indexOf('健身') >= 0) return '健身房';
  if (n.indexOf('誠品') >= 0 || n.indexOf('博客來') >= 0) return '書籍';
  if (n.indexOf('蝦皮') >= 0 || n.indexOf('momo') >= 0 || n.indexOf('PChome') >= 0) return '購物';
  if (n.indexOf('全家') >= 0 || n.indexOf('7-ELEVEN') >= 0 || n.indexOf('萊爾富') >= 0) return '基礎飲食';
  if (n.indexOf('診所') >= 0 || n.indexOf('醫院') >= 0) return '看診';
  return '雜費';
}

function guessIcon(name) {
  if (!name) return '🧾';
  const n = name;
  if (n.indexOf('全聯') >= 0 || n.indexOf('家樂福') >= 0) return '🛒';
  if (n.indexOf('麥當勞') >= 0 || n.indexOf('肯德基') >= 0) return '🍔';
  if (n.indexOf('星巴克') >= 0 || n.indexOf('路易莎') >= 0) return '☕';
  if (n.indexOf('全家') >= 0 || n.indexOf('7-ELEVEN') >= 0) return '🏪';
  if (n.indexOf('捷運') >= 0 || n.indexOf('公車') >= 0) return '🚌';
  if (n.toLowerCase().indexOf('uber') >= 0) return '🚗';
  if (n.indexOf('藥局') >= 0 || n.indexOf('藥妝') >= 0) return '💊';
  if (n.indexOf('健身') >= 0) return '🏋️';
  if (n.indexOf('蝦皮') >= 0 || n.indexOf('momo') >= 0) return '🛍️';
  if (n.indexOf('診所') >= 0 || n.indexOf('醫院') >= 0) return '🏥';
  return '🧾';
}

app.get('/', function(req, res) {
  res.json({ status: 'ok', message: 'Backend v3 running', version: '3.0' });
});

app.post('/api/invoices', async function(req, res) {
  var barcode = req.body.barcode;
  var startDate = req.body.startDate;
  var endDate = req.body.endDate;

  if (!barcode) {
    return res.status(400).json({ error: 'Missing barcode' });
  }

  // Ensure barcode starts with /
  if (barcode.charAt(0) !== '/') {
    barcode = '/' + barcode;
  }
  barcode = barcode.toUpperCase();

  var timeStamp = Math.floor(Date.now()/1000).toString();
  var cardEncrypt = aesEncrypt(barcode, API_KEY);
  var start = startDate || getStartDate();
  var end = endDate || getTodayDate();

  console.log('Query barcode:', barcode, 'len:', barcode.length);
  console.log('Date range:', start, '-', end);
  console.log('cardEncrypt:', cardEncrypt);

  var params = new URLSearchParams();
  params.append('version', '0.5');
  params.append('type', 'Carrier');
  params.append('carrierId2', barcode);
  params.append('cardEncrypt', cardEncrypt);
  params.append('timeStamp', timeStamp);
  params.append('appID', APP_ID);
  params.append('action', 'qryCarrierInv');
  params.append('startDate', start);
  params.append('endDate', end);
  params.append('onlyWinningInv', 'N');
  params.append('uuid', crypto.randomUUID());

  try {
    var response = await axios.post(MOF_API, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
      responseType: 'text',
    });

    console.log('Raw response type:', typeof response.data);
    console.log('Raw response preview:', String(response.data).slice(0, 300));

    var data;
    try {
      data = JSON.parse(response.data);
    } catch(e) {
      data = response.data;
    }

    console.log('Parsed code:', data.code, 'type:', typeof data.code);

    var code = String(data.code || '');
    if (code !== '200') {
      var msgs = {
        'INV114': '手機條碼驗證失敗，請確認條碼正確',
        'INV115': '驗證碼錯誤',
        'INV116': '手機條碼不存在',
        'INV117': '查詢區間超過限制',
        'INV106': '查無發票資料',
        'INV111': 'appID錯誤',
        'INV112': '時間戳記錯誤',
        'INV113': '版本錯誤',
      };
      var msg = msgs[code] || ('財政部回傳: ' + code + ' 原始: ' + JSON.stringify(data).slice(0,100));
      return res.status(400).json({ error: msg, code: code, raw: String(response.data).slice(0,200) });
    }

    var details = data.details || [];
    var invoices = details.map(function(inv) {
      return {
        no: inv.invNum || '',
        date: formatDate(inv.invDate),
        merchant: inv.sellerName || '未知商家',
        amount: parseInt(inv.amount) || 0,
        category: guessCategory(inv.sellerName || ''),
        icon: guessIcon(inv.sellerName || ''),
      };
    });

    res.json({ success: true, count: invoices.length, invoices: invoices });

  } catch(error) {
    console.error('Axios error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', String(error.response.data).slice(0,200));
    }
    res.status(500).json({ error: '無法連線到財政部平台: ' + error.message });
  }
});

app.post('/api/invoice-detail', async function(req, res) {
  var invNum = req.body.invNum || '';
  var params = new URLSearchParams();
  params.append('version', '0.5');
  params.append('type', 'General');
  params.append('invNum', invNum);
  params.append('action', 'qryInvDetail');
  params.append('generation', 'V2');
  params.append('appID', APP_ID);
  params.append('uuid', crypto.randomUUID());
  try {
    var r = await axios.post(MOF_API, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    });
    var items = (r.data.details || []).map(function(i) {
      return {
        name: i.description || '',
        qty: parseFloat(i.quantity) || 1,
        price: Math.round(parseFloat(i.unitPrice || 0) * parseFloat(i.quantity || 1)),
      };
    });
    res.json({ success: true, items: items });
  } catch(e) {
    res.json({ success: true, items: [] });
  }
});

app.listen(PORT, function() {
  console.log('Backend v3 started on port ' + PORT);
});

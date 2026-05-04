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
  const n = name.toLowerCase();
  if (/\u5168\u806f|\u5bb6\u6a02\u798f|\u5927\u6f64\u767c|costco|\u597d\u5e02\u591a|\u9802\u597d|\u611b\u8cb7/.test(n)) return '\u57fa\u790e\u98f2\u98df';
  if (/\u9ea5\u7576\u52de|\u80af\u5fb7\u57fa|\u6469\u65af|\u6f22\u5821\u738b|subway|\u9b0d\u9b0d\u5f35|\u5409\u91ce\u5bb6|\u722d\u9bae/.test(n)) return '\u9910\u5ede\u6d88\u8cbb';
  if (/\u661f\u5df4\u514b|starbucks|\u8def\u6613\u838e|cama|85\u5ea6|\u6e05\u5fc3|50\u5d50|\u4e00\u82b3/.test(n)) return '\u98f2\u6599\u548b\u554a';
  if (/netflix|spotify|apple|google|youtube|disney|line/.test(n)) return '\u8a02\u95b1\u8cbb';
  if (/\u4e2d\u83ef\u96fb\u4fe1|\u53f0\u7063\u5927\u54e5\u5927|\u9060\u50b3|\u53f0\u54e5\u5927|\u4e9e\u592a/.test(n)) return '\u96fb\u4fe1\u8cbb';
  if (/\u6377\u904b|\u516c\u8eca|\u53f0\u9435|\u9ad8\u9435|\u5ba2\u904b/.test(n)) return '\u5927\u773e\u904b\u8f38';
  if (/uber|\u8a08\u7a0b\u8eca|taxi/.test(n)) return 'Uber/\u8a08\u7a0b';
  if (/\u85e5\u5c40|\u85e5\u599d|\u5c48\u81e3\u6c0f|\u5eb7\u662f\u7f8e|\u5927\u6a39/.test(n)) return '\u85e5\u54c1';
  if (/\u5065\u8eab|gym/.test(n)) return '\u5065\u8eab\u623f';
  if (/\u8aa0\u54c1|\u535a\u5ba2\u4f86|\u91d1\u77f3\u5802/.test(n)) return '\u66f8\u7c4d';
  if (/\u8dd1\u76ae|\u8cfc\u7269|momo|pchome|yahoo/.test(n)) return '\u8cfc\u7269';
  if (/\u5168\u5bb6|7-eleven|\u840a\u723e\u5bcc|ok\u8d85\u5546/.test(n)) return '\u57fa\u790e\u98f2\u98df';
  if (/\u8a3a\u6240|\u91ab\u9662/.test(n)) return '\u770b\u8a3a';
  return '\u96dc\u8cbb';
}

function guessIcon(name) {
  if (!name) return '\ud83e\uddfe';
  const n = name.toLowerCase();
  if (/\u5168\u806f|\u5bb6\u6a02\u798f|\u597d\u5e02\u591a/.test(n)) return '\ud83d\uded2';
  if (/\u9ea5\u7576\u52de|\u80af\u5fb7\u57fa|\u6469\u65af/.test(n)) return '\ud83c\udf54';
  if (/\u661f\u5df4\u514b|\u8def\u6613\u838e|85\u5ea6/.test(n)) return '\u2615';
  if (/netflix|disney/.test(n)) return '\ud83c\udfac';
  if (/spotify/.test(n)) return '\ud83c\udfb5';
  if (/\u6377\u904b|\u516c\u8eca|\u53f0\u9435/.test(n)) return '\ud83d\ude8c';
  if (/uber|\u8a08\u7a0b/.test(n)) return '\ud83d\ude97';
  if (/\u85e5\u5c40|\u85e5\u599d/.test(n)) return '\ud83d\udc8a';
  if (/\u5065\u8eab|gym/.test(n)) return '\ud83c\udfcb\ufe0f';
  if (/\u8dd1\u76ae|momo|pchome/.test(n)) return '\ud83d\udecd\ufe0f';
  if (/\u5168\u5bb6|7-eleven|\u840a\u723e\u5bcc/.test(n)) return '\ud83c\udfe6';
  if (/\u8a3a\u6240|\u91ab\u9662/.test(n)) return '\ud83c\udfe5';
  return '\ud83e\uddfe';
}

app.get('/', function(req, res) {
  res.json({ status: 'ok', message: 'Backend v2 running', version: '2.0' });
});

app.post('/api/invoices', async function(req, res) {
  const barcode = req.body.barcode;
  const startDate = req.body.startDate;
  const endDate = req.body.endDate;

  if (!barcode) {
    return res.status(400).json({ error: 'Missing barcode' });
  }

  const timeStamp = Math.floor(Date.now()/1000).toString();
  const cardEncrypt = aesEncrypt(barcode, API_KEY);
  const start = startDate || getStartDate();
  const end = endDate || getTodayDate();

  console.log('Query:', barcode, start, '-', end);
  console.log('cardEncrypt:', cardEncrypt);

  const params = new URLSearchParams();
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
    const response = await axios.post(MOF_API, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });

    const data = response.data;
    console.log('MOF response code:', data.code, 'count:', (data.details||[]).length);

    if (data.code !== 200 && data.code !== '200') {
      const msgs = {
        'INV114': 'Barcode verification failed',
        'INV115': 'Wrong verification code',
        'INV116': 'Barcode does not exist',
        'INV117': 'Date range too long',
        'INV106': 'No invoices found',
      };
      const msg = msgs[data.code] || ('MOF error: ' + data.code);
      return res.status(400).json({ error: msg, code: data.code });
    }

    const invoices = (data.details || []).map(function(inv) {
      return {
        no: inv.invNum || '',
        date: formatDate(inv.invDate),
        merchant: inv.sellerName || 'Unknown',
        amount: parseInt(inv.amount) || 0,
        category: guessCategory(inv.sellerName || ''),
        icon: guessIcon(inv.sellerName || ''),
      };
    });

    res.json({ success: true, count: invoices.length, invoices: invoices });

  } catch(error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: 'Cannot connect to MOF platform' });
  }
});

app.post('/api/invoice-detail', async function(req, res) {
  const invNum = req.body.invNum;
  const invDate = req.body.invDate;

  const params = new URLSearchParams();
  params.append('version', '0.5');
  params.append('type', 'General');
  params.append('invNum', invNum || '');
  params.append('action', 'qryInvDetail');
  params.append('generation', 'V2');
  params.append('appID', APP_ID);
  params.append('uuid', crypto.randomUUID());

  try {
    const r = await axios.post(MOF_API, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    });
    const items = (r.data.details || []).map(function(i) {
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
  console.log('Backend started on port ' + PORT);
});

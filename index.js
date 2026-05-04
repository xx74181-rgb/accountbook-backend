const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// 允許前端跨來源呼叫
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
}));
app.use(express.json());

// ── 財政部 API 設定 ──
const MOF_BASE = 'https://einvoice.nat.gov.tw/PB2CAPIVAN/invapp/InvApp';
const APP_ID = 'EINV_APP_001'; // 財政部開放的 App ID

// ── 工具：產生財政部 API 驗證碼 ──
function getMofVerifyCode(barcode, cardEncrypt, timeStamp) {
  const str = `cardNo=${barcode}&cardEncrypt=${cardEncrypt}&timeStamp=${timeStamp}`;
  return crypto.createHmac('sha256', 'EINV_APP_001').update(str).digest('base64');
}

// ── 健康檢查 ──
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: '記帳本後端運作中 ✓' });
});

// ── 查詢載具發票列表 ──
app.post('/api/invoices', async (req, res) => {
  const { barcode, cardEncrypt, startDate, endDate } = req.body;

  if (!barcode || !cardEncrypt) {
    return res.status(400).json({ error: '請提供手機條碼與驗證碼' });
  }

  const timeStamp = Math.floor(Date.now() / 1000).toString();

  try {
    const params = new URLSearchParams({
      version: '0.5',
      type: 'Carrier',
      carrierId2: barcode,
      cardEncrypt: cardEncrypt,
      timeStamp: timeStamp,
      appID: APP_ID,
      action: 'qryCarrierInv',
      startDate: startDate || getDefaultStartDate(),
      endDate: endDate || getTodayDate(),
      onlyWinningInv: 'N',
      uuid: crypto.randomUUID(),
    });

    const response = await axios.post(MOF_BASE, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 10000,
    });

    const data = response.data;

    // 財政部回傳 code=200 才是成功
    if (data.code !== 200 && data.code !== '200') {
      return res.status(400).json({
        error: getMofError(data.code),
        code: data.code,
      });
    }

    // 整理發票資料
    const invoices = (data.details || []).map(inv => ({
      no: inv.invNum || '',
      date: formatMofDate(inv.invDate),
      merchant: inv.sellerName || '未知商家',
      amount: parseInt(inv.amount) || 0,
      category: guessCategoryFromMerchant(inv.sellerName || ''),
      icon: guessIconFromMerchant(inv.sellerName || ''),
    }));

    res.json({
      success: true,
      count: invoices.length,
      invoices,
    });

  } catch (error) {
    console.error('財政部 API 錯誤:', error.message);

    // 如果是測試/開發環境，回傳假資料
    if (process.env.NODE_ENV === 'development' || process.env.USE_MOCK === 'true') {
      return res.json(getMockInvoices());
    }

    res.status(500).json({ error: '無法連線到財政部平台，請稍後再試' });
  }
});

// ── 查詢單張發票明細 ──
app.post('/api/invoice-detail', async (req, res) => {
  const { invNum, invDate, sellerBan, buyer, uuid } = req.body;

  try {
    const params = new URLSearchParams({
      version: '0.5',
      type: 'General',
      invNum,
      action: 'qryInvDetail',
      generation: 'V2',
      invTerm: invDate ? invDate.slice(0, 6) : '',
      appID: APP_ID,
      uuid: uuid || crypto.randomUUID(),
    });

    const response = await axios.post(MOF_BASE, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    });

    const data = response.data;
    const items = (data.details || []).map(item => ({
      name: item.description || '',
      qty: parseFloat(item.quantity) || 1,
      price: Math.round(parseFloat(item.unitPrice) * parseFloat(item.quantity)) || 0,
    }));

    res.json({ success: true, items });
  } catch (error) {
    res.json({ success: true, items: [] });
  }
});

// ── 工具函式 ──
function getTodayDate() {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

function getDefaultStartDate() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

function formatMofDate(dateStr) {
  if (!dateStr) return getTodayDate();
  // 民國年轉西元
  if (dateStr.length === 7) {
    const y = parseInt(dateStr.slice(0, 3)) + 1911;
    return `${y}-${dateStr.slice(3, 5)}-${dateStr.slice(5, 7)}`;
  }
  return dateStr;
}

function getMofError(code) {
  const errors = {
    'INV114': '手機條碼或驗證碼錯誤',
    'INV115': '驗證碼錯誤',
    'INV116': '手機條碼不存在',
    'INV117': '查詢區間超過限制（最多3個月）',
    'INV105': '查詢日期格式錯誤',
  };
  return errors[code] || `財政部回傳錯誤 (${code})`;
}

// AI 分類：根據商家名稱猜分類
function guessCategoryFromMerchant(name) {
  const n = name.toLowerCase();
  if (/全聯|家樂福|大潤發|costco|好市多|頂好|惠康/.test(n)) return '基礎飲食';
  if (/麥當勞|肯德基|摩斯|漢堡王|subway|鬍鬚張|吉野家|爭鮮/.test(n)) return '餐廳消費';
  if (/星巴克|starbucks|路易莎|cama|85度c|清心|50嵐|一芳/.test(n)) return '飲料咖啡';
  if (/netflix|spotify|apple|google|youtube|disney|line/.test(n)) return '訂閱費';
  if (/中華電信|台灣大哥大|遠傳|台哥大|亞太/.test(n)) return '電信費';
  if (/捷運|公車|台鐵|高鐵|公路|客運/.test(n)) return '大眾運輸';
  if (/uber|計程車|taxi/.test(n)) return 'Uber/計程';
  if (/藥局|藥妝|屈臣氏|康是美|大樹|躍獅/.test(n)) return '藥品';
  if (/健身|gym|世界健身|全家健身/.test(n)) return '健身房';
  if (/誠品|博客來|金石堂/.test(n)) return '書籍';
  if (/蝦皮|shopee|momo|pchome|yahoo購物/.test(n)) return '購物';
  if (/全家|7-eleven|seven|萊爾富|ok超商/.test(n)) return '基礎飲食';
  return '雜費';
}

function guessIconFromMerchant(name) {
  const n = name.toLowerCase();
  if (/全聯|家樂福|好市多|costco/.test(n)) return '🛒';
  if (/麥當勞|肯德基|摩斯|漢堡/.test(n)) return '🍔';
  if (/星巴克|路易莎|cama|85度/.test(n)) return '☕';
  if (/netflix|disney/.test(n)) return '🎬';
  if (/spotify|apple music/.test(n)) return '🎵';
  if (/捷運|公車|台鐵|高鐵/.test(n)) return '🚌';
  if (/uber/.test(n)) return '🚗';
  if (/藥局|藥妝/.test(n)) return '💊';
  if (/健身/.test(n)) return '🏋️';
  if (/蝦皮|momo|pchome/.test(n)) return '🛍️';
  if (/全家|7-eleven/.test(n)) return '🏪';
  return '🧾';
}

// Mock 資料（開發測試用）
function getMockInvoices() {
  return {
    success: true,
    count: 5,
    invoices: [
      { no: 'AB-12345678', date: '2026-05-04', merchant: '全聯福利中心', amount: 487, category: '基礎飲食', icon: '🛒' },
      { no: 'CD-23456789', date: '2026-05-03', merchant: '麥當勞', amount: 198, category: '餐廳消費', icon: '🍔' },
      { no: 'EF-34567890', date: '2026-05-02', merchant: 'momo購物網', amount: 899, category: '購物', icon: '🛍️' },
      { no: 'GH-45678901', date: '2026-05-01', merchant: 'Spotify', amount: 149, category: '訂閱費', icon: '🎵' },
      { no: 'IJ-56789012', date: '2026-05-01', merchant: 'Uber', amount: 245, category: 'Uber/計程', icon: '🚗' },
    ],
  };
}

app.listen(PORT, () => {
  console.log(`✓ 記帳本後端啟動，Port: ${PORT}`);
});

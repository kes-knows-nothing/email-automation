require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const crypto = require('crypto');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('*', cors());
app.use(express.json());

// ── SES ──
const ses = new SESClient({
  region: process.env.AWS_REGION || 'ap-northeast-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

// ── Supabase ──
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ── 수신거부 토큰 (unsubscribe.html과 동일한 시크릿) ──
const UNSUB_SECRET = 'tripbtoz-unsub-2025';
function generateUnsubToken(email) {
  return crypto.createHmac('sha256', UNSUB_SECRET)
    .update(email.toLowerCase().trim())
    .digest('base64url');
}
function getUnsubUrl(email) {
  const base = process.env.UNSUB_BASE_URL || 'http://localhost:3000/unsubscribe.html';
  return `${base}?e=${Buffer.from(email).toString('base64')}&t=${generateUnsubToken(email)}`;
}

const DB = {
  host: '127.0.0.1',
  port: 40007,
  user: 'querypie',
  password: '30ff83588736c56a',
  database: 'tripbtoz',
  connectTimeout: 10000,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
};

const pool = mysql.createPool(DB);

const PRESET_SQLS = {
  member: `
    SELECT DISTINCT email
    FROM tripbtoz.users_0519
    WHERE mkt_email_agree = 1
      AND status = 'AT'
      AND email IS NOT NULL
      AND email != ''`,
  guest: `
    SELECT DISTINCT bo.email
    FROM tripbtoz_payment.checkout_detail cd
    JOIN tripbtoz.checkouts c ON c.id = cd.checkout_id
    JOIN tripbtoz.bookings b ON b.checkout_id = cd.checkout_id
    JOIN tripbtoz.bookings_octopus bo ON bo.trxNum = b.booking_code
    WHERE cd.ad_policy_agreement_yn = 1
      AND c.user_type = 'guest'
      AND bo.email IS NOT NULL
      AND bo.email != ''`,
  all: `
    SELECT DISTINCT email FROM tripbtoz.users_0519 WHERE mkt_email_agree = 1 AND status = 'AT' AND email IS NOT NULL AND email != ''
    UNION
    SELECT DISTINCT bo.email
    FROM tripbtoz_payment.checkout_detail cd
    JOIN tripbtoz.checkouts c ON c.id = cd.checkout_id
    JOIN tripbtoz.bookings b ON b.checkout_id = cd.checkout_id
    JOIN tripbtoz.bookings_octopus bo ON bo.trxNum = b.booking_code
    WHERE cd.ad_policy_agreement_yn = 1
      AND c.user_type = 'guest'
      AND bo.email IS NOT NULL
      AND bo.email != ''`,
};

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24시간
const cache = {}; // { key: { rows, columns, total, cachedAt } }

async function runQuery(sql) {
  const conn = await pool.getConnection();
  try {
    const start = Date.now();
    const [rows, fields] = await conn.query(sql);
    const elapsed = Date.now() - start;
    if(!fields) return { type: 'ok', affectedRows: rows.affectedRows, elapsed };
    return {
      type: 'select',
      columns: fields.map(f => f.name),
      rows: rows.map(r => fields.map(f => r[f.name])),
      total: rows.length,
      elapsed,
    };
  } finally {
    conn.release();
  }
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 도시 검색 자동완성
app.get('/api/cities', async (req, res) => {
  const q = (req.query.q || '').trim();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT DISTINCT city_kr FROM hotels
       WHERE (city_kr LIKE ? OR city LIKE ?)
         AND city_kr IS NOT NULL AND city_kr != ''
       ORDER BY city_kr LIMIT 20`,
      [`%${q}%`, `%${q}%`]
    );
    res.json(rows.map(r => r.city_kr));
  } catch(err) {
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// 일반 쿼리
app.post('/api/query', async (req, res) => {
  const { sql } = req.body;
  if(!sql || !sql.trim()) return res.status(400).json({ error: 'SQL이 없습니다' });
  try {
    res.json(await runQuery(sql));
  } catch(err) {
    res.status(400).json({ error: err.message });
  }
});

// 프리셋 (캐시 적용)
app.get('/api/preset/:key', async (req, res) => {
  const key = req.params.key;
  if(!PRESET_SQLS[key]) return res.status(404).json({ error: '없는 프리셋입니다' });

  const hit = cache[key];
  if(hit && Date.now() - hit.cachedAt < CACHE_TTL) {
    return res.json({ ...hit.data, cached: true, cachedAt: hit.cachedAt });
  }

  try {
    const data = await runQuery(PRESET_SQLS[key]);
    cache[key] = { data, cachedAt: Date.now() };
    res.json({ ...data, cached: false, cachedAt: cache[key].cachedAt });
  } catch(err) {
    res.status(400).json({ error: err.message });
  }
});

// 프리셋 수신자 수 조회
app.get('/api/preset-count/:key', async (req, res) => {
  const key = req.params.key;
  if(!PRESET_SQLS[key]) return res.status(404).json({ error: '없는 프리셋입니다' });
  try {
    const result = await runQuery(PRESET_SQLS[key]);
    res.json({ count: result.rows?.length || 0 });
  } catch(err) {
    res.status(400).json({ error: err.message });
  }
});

// 프리셋 캐시 강제 갱신
app.delete('/api/preset/:key/cache', async (req, res) => {
  const key = req.params.key;
  delete cache[key];
  res.json({ ok: true });
});

// ═══════════════════════════════════════════
// EMAIL SEND
// ═══════════════════════════════════════════

// 발송 진행 상태 인메모리 저장
const sendJobs = {};

// ── 다이나믹 콘텐츠 렌더링 ──
function getDateVars() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based
  const nextM = m + 1 > 11 ? 0 : m + 1;
  const nextY = m + 1 > 11 ? y + 1 : y;
  const pad = n => String(n).padStart(2, '0');
  const lastDay = new Date(nextY, nextM + 1, 0).getDate();
  const KO_MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  return {
    SEND_MONTH: KO_MONTHS[m],
    NEXT_MONTH: KO_MONTHS[nextM],
    NEXT_MONTH_START: `${nextY}-${pad(nextM + 1)}-01`,
    NEXT_MONTH_END:   `${nextY}-${pad(nextM + 1)}-${pad(lastDay)}`,
  };
}

function getNextMondayDates() {
  const now = new Date();
  const daysToMonday = (8 - now.getDay()) % 7 || 7;
  const ci = new Date(now); ci.setDate(now.getDate() + daysToMonday);
  const co = new Date(ci); co.setDate(ci.getDate() + 1);
  const fmt = d => d.toISOString().split('T')[0];
  return { checkIn: fmt(ci), checkOut: fmt(co) };
}

function buildHotelUrl(h, utmCampaign) {
  const base = 'https://www.tripbtoz.com/hotels';
  const { checkIn, checkOut } = getNextMondayDates();
  const query = encodeURIComponent(h.name_kr || h.name || '');
  const utm = utmCampaign ? `&utm_source=email&utm_medium=newsletter&utm_campaign=${encodeURIComponent(utmCampaign)}` : '';
  return `${base}/${h.hotel_id}?check-in=${checkIn}&check-out=${checkOut}&rooms=1&room-0-adults=2&room-0-children=0&query=${query}&searchId=${h.hotel_id}&searchType=HOTEL${utm}`;
}

function renderHotelCardsHtml(hotels, utmCampaign) {
  if(!hotels.length) return '';
  const cards = hotels.map(h => {
    const stars = '★'.repeat(Math.floor(parseFloat(h.star_rating) || 0));
    const url = h.hotel_id ? buildHotelUrl(h, utmCampaign) : '#';
    const fmt = n => String(n||0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    let priceHtml;
    if (h.price_available) {
      const discountBadge = h.discount_rate > 0
        ? `<span style="font-size:11px;color:#7B3CFF;background:#f0ebff;padding:2px 7px;border-radius:10px;font-weight:600;">${h.discount_rate}% 할인</span>`
        : '';
      const strikethrough = h.discount_rate > 0 && h.regular_price
        ? `<p style="margin:2px 0 0;font-size:11px;color:#bbb;text-decoration:line-through;">${fmt(h.regular_price)} 원</p>`
        : '';
      priceHtml = `<p style="margin:8px 0 0;font-size:15px;color:#7B3CFF;font-weight:700;">${fmt(h.discounted_price)} 원~ ${discountBadge}</p>${strikethrough}`;
    } else if (h.db_min_price) {
      priceHtml = `<p style="margin:8px 0 0;font-size:15px;color:#7B3CFF;font-weight:700;">${fmt(h.db_min_price)} 원~</p>`;
    } else {
      priceHtml = `<p style="margin:8px 0 0;font-size:15px;color:#ddd;font-weight:700;">가격 정보 없음</p>`;
    }
    return `<a href="${url}" target="_blank" style="display:inline-block;vertical-align:top;width:240px;margin:8px;background:#fff;border-radius:14px;border:1px solid #e8e8f0;padding:18px;box-shadow:0 2px 12px rgba(0,0,0,0.07);text-decoration:none;transition:box-shadow 0.2s;">
  <div style="font-size:10px;color:#7B3CFF;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:6px;">${h.city_kr || ''}</div>
  <div style="font-size:13px;font-weight:700;color:#1a1a2e;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${h.name_kr || h.name || ''}</div>
  <div style="font-size:11px;color:#999;margin-top:4px;">${stars} ${h.star_rating || ''}성급</div>
  ${priceHtml}
  <div style="margin-top:12px;padding:7px 0;text-align:center;background:#f5f0ff;border-radius:8px;font-size:12px;color:#7B3CFF;font-weight:600;">예약하기 →</div>
</a>`;
  }).join('\n');
  return `<div style="text-align:center;padding:8px 0;">${cards}</div>`;
}

async function fetchDynamicContent(contentQuery, contentLimit) {
  if(!contentQuery || !contentQuery.trim()) return {};
  const vars = getDateVars();
  // SQL 내 날짜 변수 치환
  let sql = contentQuery
    .replace(/\{\{NEXT_MONTH_START\}\}/g, `'${vars.NEXT_MONTH_START}'`)
    .replace(/\{\{NEXT_MONTH_END\}\}/g,   `'${vars.NEXT_MONTH_END}'`)
    .replace(/\{\{LIMIT\}\}/g, String(contentLimit || 6));

  const result = await runQuery(sql);
  if(result.type !== 'select' || !result.rows.length) return { ...vars, HOTEL_CARDS: '' };

  // hotel_id 컬럼 찾아서 가격 API 호출
  const hotelIdIdx  = result.columns.findIndex(c => c.toLowerCase() === 'hotel_id' || c.toLowerCase() === 'id');
  const nameIdx     = result.columns.findIndex(c => ['name_kr','name_ko','name'].includes(c.toLowerCase()));
  const cityIdx     = result.columns.findIndex(c => c.toLowerCase() === 'city_kr');
  const starIdx     = result.columns.findIndex(c => c.toLowerCase() === 'star_rating');
  const minPriceIdx = result.columns.findIndex(c => c.toLowerCase() === 'min_price');

  const hotels = result.rows.slice(0, contentLimit || 6).map(r => ({
    hotel_id:    hotelIdIdx  >= 0 ? r[hotelIdIdx]  : null,
    name_kr:     nameIdx     >= 0 ? r[nameIdx]     : '',
    city_kr:     cityIdx     >= 0 ? r[cityIdx]     : '',
    star_rating: starIdx     >= 0 ? r[starIdx]     : '',
    db_min_price: minPriceIdx >= 0 ? (r[minPriceIdx] ? Number(r[minPriceIdx]) : null) : null,
    price_available: false,
  }));

  // 호텔 가격 병렬 조회
  if(hotelIdIdx >= 0) {
    await Promise.all(hotels.map(async h => {
      try {
        const res = await fetch(`http://localhost:3001/api/hotel-price/${h.hotel_id}`, { signal: AbortSignal.timeout(8000) });
        const p = await res.json();
        if(p.available) {
          h.price_available  = true;
          h.discounted_price = p.discounted_price;
          h.regular_price    = p.regular_price;
          h.discount_rate    = p.discount_rate;
        }
      } catch(e) { /* 가격 조회 실패는 무시 */ }
    }));
  }

  const priced = hotels.filter(h => h.price_available || h.db_min_price);
  console.log(`[content] 호텔 ${priced.length}개 렌더링 (가격 없음 ${hotels.length - priced.length}개 제외)`);
  return { ...vars, HOTEL_CARDS: renderHotelCardsHtml(priced, contentLimit?._utmCampaign) };
}

async function fetchDynamicContentWithUTM(contentQuery, contentLimit, utmCampaign) {
  if(!contentQuery || !contentQuery.trim()) return {};
  const vars = getDateVars();
  let sql = contentQuery
    .replace(/\{\{NEXT_MONTH_START\}\}/g, `'${vars.NEXT_MONTH_START}'`)
    .replace(/\{\{NEXT_MONTH_END\}\}/g,   `'${vars.NEXT_MONTH_END}'`)
    .replace(/\{\{LIMIT\}\}/g, String(contentLimit || 6));

  const result = await runQuery(sql);
  if(result.type !== 'select' || !result.rows.length) return { ...vars, HOTEL_CARDS: '' };

  const hotelIdIdx  = result.columns.findIndex(c => c.toLowerCase() === 'hotel_id' || c.toLowerCase() === 'id');
  const nameIdx     = result.columns.findIndex(c => ['name_kr','name_ko','name'].includes(c.toLowerCase()));
  const cityIdx     = result.columns.findIndex(c => c.toLowerCase() === 'city_kr');
  const starIdx     = result.columns.findIndex(c => c.toLowerCase() === 'star_rating');
  const minPriceIdx = result.columns.findIndex(c => c.toLowerCase() === 'min_price');

  const hotels = result.rows.slice(0, contentLimit || 6).map(r => ({
    hotel_id:    hotelIdIdx  >= 0 ? r[hotelIdIdx]  : null,
    name_kr:     nameIdx     >= 0 ? r[nameIdx]     : '',
    city_kr:     cityIdx     >= 0 ? r[cityIdx]     : '',
    star_rating: starIdx     >= 0 ? r[starIdx]     : '',
    db_min_price: minPriceIdx >= 0 ? (r[minPriceIdx] ? Number(r[minPriceIdx]) : null) : null,
    price_available: false,
  }));

  if(hotelIdIdx >= 0) {
    await Promise.all(hotels.map(async h => {
      try {
        const res = await fetch(`http://localhost:3001/api/hotel-price/${h.hotel_id}`, { signal: AbortSignal.timeout(8000) });
        const p = await res.json();
        if(p.available) {
          h.price_available  = true;
          h.discounted_price = p.discounted_price;
          h.regular_price    = p.regular_price;
          h.discount_rate    = p.discount_rate;
        }
      } catch(e) {}
    }));
  }

  const priced2 = hotels.filter(h => h.price_available || h.db_min_price);
  console.log(`[content] 호텔 ${priced2.length}개 렌더링 (가격 없음 ${hotels.length - priced2.length}개 제외) (UTM: ${utmCampaign || 'none'})`);
  return { ...vars, HOTEL_CARDS: renderHotelCardsHtml(priced2, utmCampaign) };
}

async function executeSend(jobId, { templateId, segmentId, segmentQuery, presetKey, subject, fromName, scheduleId, contentQuery, contentLimit, utmCampaign, dryRun }) {
  const job = sendJobs[jobId];
  job.status = 'running';
  job.dryRun = !!dryRun;

  try {
    // 1. 템플릿 HTML 가져오기
    const { data: tpl, error: tplErr } = await sb.from('templates').select('html,name').eq('id', templateId).single();
    if(tplErr || !tpl) throw new Error('템플릿을 찾을 수 없습니다');

    // 2. 세그먼트 이메일 목록
    let emails = [];
    // presetKey 또는 __PRESET__: 형태 segment_query 처리
    if(presetKey && PRESET_SQLS[presetKey]) {
      segmentQuery = PRESET_SQLS[presetKey];
    } else if(segmentQuery && segmentQuery.startsWith('__PRESET__:')) {
      const pk = segmentQuery.replace('__PRESET__:', '');
      if(PRESET_SQLS[pk]) segmentQuery = PRESET_SQLS[pk];
    }
    if(segmentQuery && segmentQuery.trim()) {
      const result = await runQuery(segmentQuery);
      if(result.type === 'select') {
        const emailIdx = result.columns.findIndex(c => c.toLowerCase() === 'email');
        emails = result.rows.map(r => r[emailIdx >= 0 ? emailIdx : 0]).filter(Boolean);
      }
      console.log(`[send] 세그먼트 쿼리 재실행: ${emails.length}명`);
    } else if(segmentId) {
      console.log(`[send] segmentId 조회: ${segmentId} (type: ${typeof segmentId})`);
      const { data: seg, error: segErr } = await sb.from('segments').select('emails').eq('id', segmentId).single();
      if(segErr) console.error(`[send] segment 조회 오류:`, segErr.message);
      if(segErr || !seg) throw new Error('세그먼트를 찾을 수 없습니다');
      emails = seg.emails || [];
      console.log(`[send] segment 이메일 수: ${emails.length}`);
    } else {
      console.warn('[send] segmentId도 segmentQuery도 없음 → 수신자 없음');
    }

    // 3. 수신거부 필터링
    const { data: unsubs } = await sb.from('unsubscribers').select('email');
    const unsubSet = new Set((unsubs || []).map(u => u.email.toLowerCase()));
    const filtered = emails.filter(e => e && !unsubSet.has(e.toLowerCase()));

    job.total = filtered.length;
    job.filtered = emails.length - filtered.length;

    // 4. 다이나믹 콘텐츠 렌더링 (호텔 카드 등)
    job.status = 'rendering';
    const dynVars = await fetchDynamicContentWithUTM(contentQuery, contentLimit, utmCampaign || subject);
    console.log(`[send] 동적 변수: ${Object.keys(dynVars).join(', ')}`);

    // 기본 HTML 렌더링 (동적 변수 치환 + 트래킹)
    const trackBase = process.env.SERVER_URL || 'http://localhost:3001';
    function renderHtml(baseHtml, email) {
      let html = baseHtml;
      for(const [k, v] of Object.entries(dynVars)) {
        html = html.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
      }
      const unsubUrl = getUnsubUrl(email);
      const sendDate = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
      html = html.replace(/\{\{UNSUB_URL\}\}/g, unsubUrl)
                 .replace(/#\{UNSUBSCRIBE_URL\}/g, unsubUrl)
                 .replace(/\{\{UNSUBSCRIBE_URL\}\}/g, unsubUrl)
                 .replace(/\{\{SEND_DATE\}\}/g, sendDate);

      const eHash = Buffer.from(email).toString('base64url');

      // 링크 트래킹 래핑 (unsubscribe, 트래킹 URL 제외)
      if(scheduleId) {
        html = html.replace(/href="(https?:\/\/[^"]+)"/g, (match, url) => {
          if(url.includes('/track/') || url.includes('unsubscribe')) return match;
          const clickUrl = `${trackBase}/track/click?sid=${scheduleId}&e=${eHash}&url=${encodeURIComponent(url)}`;
          return `href="${clickUrl}"`;
        });
      }

      const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"><style>*{font-family:'Pretendard','Malgun Gothic','맑은 고딕',Apple SD Gothic Neo,sans-serif!important}</style></head><body style="margin:0;padding:0;background:#f5f5f5;font-family:'Pretendard','Malgun Gothic','맑은 고딕',Apple SD Gothic Neo,sans-serif;"><table cellpadding="0" cellspacing="0" width="100%" style="background:#f5f5f5;"><tr><td align="center" style="padding:20px 0;"><div style="width:600px;max-width:100%;margin:0 auto;background:#fff;">${html}</div></td></tr></table>${scheduleId ? `<img src="${trackBase}/track/open?sid=${scheduleId}&e=${eHash}" width="1" height="1" style="display:none" alt="">` : ''}</body></html>`;
      return fullHtml;
    }

    // DRY RUN: SES 호출 없이 결과 시뮬레이션
    if(dryRun) {
      job.preview = {
        subject,
        from: `${fromName || process.env.SES_FROM_NAME || '트립비토즈'} <${process.env.SES_FROM_EMAIL || 'no-reply@tripbtoz.com'}>`,
        sampleEmails: filtered.slice(0, 5),
        sampleUnsubUrl: filtered[0] ? getUnsubUrl(filtered[0]) : getUnsubUrl('test@example.com'),
        hasUnsubPlaceholder: tpl.html.includes('{{UNSUB_URL}}'),
        hasHotelCards: tpl.html.includes('{{HOTEL_CARDS}}'),
        dynVarKeys: Object.keys(dynVars),
        sampleHtml: renderHtml(tpl.html, filtered[0] || 'test@example.com').slice(0, 500),
      };
      await new Promise(r => setTimeout(r, 600));
      job.sent = filtered.length;
      job.status = 'done';
      return;
    }

    const from = `${fromName || process.env.SES_FROM_NAME || '트립비토즈'} <${process.env.SES_FROM_EMAIL}>`;
    job.status = 'running';

    // 5. 10개씩 배치 발송
    for(let i = 0; i < filtered.length; i += 10) {
      const batch = filtered.slice(i, i + 10);
      await Promise.all(batch.map(async email => {
        const html = renderHtml(tpl.html, email);
        try {
          await ses.send(new SendEmailCommand({
            Source: from,
            Destination: { ToAddresses: [email] },
            Message: {
              Subject: { Data: subject, Charset: 'UTF-8' },
              Body: { Html: { Data: html, Charset: 'UTF-8' } },
            },
          }));
          job.sent++;
        } catch(e) {
          job.failed++;
          job.errors.push({ email, error: e.message });
        }
      }));
      if(i + 10 < filtered.length) await new Promise(r => setTimeout(r, 800));
    }

    // 6. 스케줄 상태 업데이트
    if(scheduleId) {
      const finalStatus = (job.sent === 0 && job.failed > 0) ? 'failed' : 'sent';
      const { error: updErr } = await sb.from('email_schedules').update({
        status: finalStatus,
        sent_at: new Date().toISOString(),
        sent_count: job.sent,
        failed_count: job.failed,
      }).eq('id', scheduleId);
      if(updErr) console.error('[send] schedule update error:', updErr.message);
      else console.log(`[send] schedule ${scheduleId} → ${finalStatus}`);
    } else {
      console.warn('[send] scheduleId 없음 — 현황판 미기록');
    }

    // 7. 발송 결과 리포트 메일
    const reportTo = process.env.REPORT_EMAIL;
    if(reportTo) {
      const sentAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      const errorRows = job.errors.slice(0, 10).map(e =>
        `<tr><td style="padding:4px 8px;color:#555;">${e.email}</td><td style="padding:4px 8px;color:#e55;">${e.error}</td></tr>`
      ).join('');
      const reportHtml = `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#222;">
  <h2 style="margin:0 0 4px;font-size:18px;">📨 이메일 발송 완료 리포트</h2>
  <p style="color:#888;font-size:13px;margin:0 0 20px;">${sentAt}</p>
  <table style="width:100%;border-collapse:collapse;background:#f9f9f9;border-radius:10px;overflow:hidden;">
    <tr><td style="padding:10px 16px;font-size:13px;color:#555;">발송 제목</td><td style="padding:10px 16px;font-weight:600;">${subject}</td></tr>
    <tr style="background:#fff;"><td style="padding:10px 16px;font-size:13px;color:#555;">발송 대상</td><td style="padding:10px 16px;font-weight:600;">${job.total.toLocaleString()}명</td></tr>
    <tr><td style="padding:10px 16px;font-size:13px;color:#555;">✅ 발송 성공</td><td style="padding:10px 16px;font-weight:700;color:#16a34a;">${job.sent.toLocaleString()}명</td></tr>
    <tr style="background:#fff;"><td style="padding:10px 16px;font-size:13px;color:#555;">❌ 발송 실패</td><td style="padding:10px 16px;font-weight:700;color:#dc2626;">${job.failed.toLocaleString()}명</td></tr>
    <tr><td style="padding:10px 16px;font-size:13px;color:#555;">🚫 수신거부 제외</td><td style="padding:10px 16px;">${job.filtered.toLocaleString()}명</td></tr>
  </table>
  ${job.errors.length > 0 ? `
  <h3 style="font-size:13px;margin:20px 0 8px;color:#dc2626;">실패 목록 (최대 10건)</h3>
  <table style="width:100%;border-collapse:collapse;font-size:12px;">
    <tr style="background:#fee2e2;"><th style="padding:4px 8px;text-align:left;">이메일</th><th style="padding:4px 8px;text-align:left;">오류</th></tr>
    ${errorRows}
  </table>` : ''}
  <p style="font-size:11px;color:#bbb;margin-top:24px;">트립비토즈 이메일 자동화 시스템</p>
</div>`;
      try {
        await ses.send(new SendEmailCommand({
          Source: `트립비토즈 이메일시스템 <${process.env.SES_FROM_EMAIL}>`,
          Destination: { ToAddresses: [reportTo] },
          Message: {
            Subject: { Data: `[발송완료] ${subject} · 성공 ${job.sent.toLocaleString()}명 / 실패 ${job.failed}명`, Charset: 'UTF-8' },
            Body: { Html: { Data: reportHtml, Charset: 'UTF-8' } },
          },
        }));
        console.log(`[report] 결과 리포트 → ${reportTo}`);
      } catch(e) {
        console.error(`[report] 리포트 발송 실패: ${e.message}`);
      }
    }

    job.status = 'done';
  } catch(e) {
    job.status = 'error';
    job.errorMessage = e.message;
    console.error('[send]', e.message);
    if(scheduleId) {
      await sb.from('email_schedules').update({
        status: 'failed',
        sent_at: new Date().toISOString(),
      }).eq('id', scheduleId);
      console.log(`[send] schedule ${scheduleId} → failed`);
    }
  }
}

// 발송 시작
app.post('/api/send', async (req, res) => {
  const { templateId, segmentId, segmentQuery, presetKey, subject, fromName, scheduleId, contentQuery, contentLimit, utmCampaign, dryRun } = req.body;
  if(!templateId || !subject) {
    return res.status(400).json({ error: 'templateId, subject 필수' });
  }
  if(!segmentId && !segmentQuery && !presetKey) {
    return res.status(400).json({ error: 'segmentId 또는 segmentQuery 필수' });
  }
  if(!dryRun && !process.env.AWS_ACCESS_KEY_ID) {
    return res.status(400).json({ error: 'AWS 자격증명이 .env에 설정되지 않았습니다' });
  }
  const jobId = `job_${Date.now()}`;
  sendJobs[jobId] = { status: 'running', sent: 0, failed: 0, total: 0, filtered: 0, errors: [] };
  executeSend(jobId, { templateId, segmentId, segmentQuery, presetKey, subject, fromName, scheduleId, contentQuery, contentLimit, utmCampaign, dryRun });
  res.json({ jobId });
});

// 다이나믹 콘텐츠 미리보기
app.post('/api/preview-content', async (req, res) => {
  const { contentQuery, contentLimit } = req.body;
  try {
    const result = await fetchDynamicContent(contentQuery, contentLimit || 6);
    // hotels 배열만 추출해서 반환
    const vars = getDateVars();
    let sql = contentQuery
      .replace(/\{\{NEXT_MONTH_START\}\}/g, `'${vars.NEXT_MONTH_START}'`)
      .replace(/\{\{NEXT_MONTH_END\}\}/g,   `'${vars.NEXT_MONTH_END}'`)
      .replace(/\{\{LIMIT\}\}/g, String(contentLimit || 6));
    const qResult = await runQuery(sql);
    if(qResult.type !== 'select') return res.json({ hotels: [] });

    const hotelIdIdx  = qResult.columns.findIndex(c => c.toLowerCase() === 'hotel_id' || c.toLowerCase() === 'id');
    const nameIdx     = qResult.columns.findIndex(c => ['name_kr','name_ko','name'].includes(c.toLowerCase()));
    const cityIdx     = qResult.columns.findIndex(c => c.toLowerCase() === 'city_kr');
    const starIdx     = qResult.columns.findIndex(c => c.toLowerCase() === 'star_rating');
    const minPriceIdx = qResult.columns.findIndex(c => c.toLowerCase() === 'min_price');

    const hotels = qResult.rows.slice(0, contentLimit || 6).map(r => ({
      hotel_id:    hotelIdIdx  >= 0 ? r[hotelIdIdx]  : null,
      name_kr:     nameIdx     >= 0 ? r[nameIdx]     : '',
      city_kr:     cityIdx     >= 0 ? r[cityIdx]     : '',
      star_rating: starIdx     >= 0 ? r[starIdx]     : '',
      db_min_price: minPriceIdx >= 0 ? (r[minPriceIdx] ? Number(r[minPriceIdx]) : null) : null,
      price_available: false,
    }));

    if(hotelIdIdx >= 0) {
      await Promise.all(hotels.map(async h => {
        try {
          const apiRes = await fetch(`http://localhost:3001/api/hotel-price/${h.hotel_id}`, { signal: AbortSignal.timeout(6000) });
          const p = await apiRes.json();
          if(p.available) { h.price_available = true; h.discounted_price = p.discounted_price; h.regular_price = p.regular_price; h.discount_rate = p.discount_rate; }
        } catch(e) {}
      }));
    }
    res.json({ hotels: hotels.filter(h => h.price_available || h.db_min_price) });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

// ── 이메일 트래킹 ──
const PIXEL_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

app.get('/track/open', async (req, res) => {
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store,no-cache,must-revalidate' });
  res.send(PIXEL_GIF);
  const { sid, e } = req.query;
  if(sid) {
    const { error } = await sb.from('email_events').insert({ schedule_id: sid, email_hash: e || null, event_type: 'open' });
    if(error) console.error('[track/open] Supabase error:', error.message, '| sid:', sid);
  }
});

app.get('/track/click', async (req, res) => {
  const { sid, e, url } = req.query;
  const target = url ? decodeURIComponent(url) : 'https://www.tripbtoz.com';
  res.redirect(302, target);
  if(sid && url) {
    const { error } = await sb.from('email_events').insert({ schedule_id: sid, email_hash: e || null, event_type: 'click', url: target });
    if(error) console.error('[track/click] Supabase error:', error.message, '| sid:', sid);
  }
});

// 캠페인 통계 조회
app.get('/api/campaign-stats/:scheduleId', async (req, res) => {
  const { scheduleId } = req.params;
  const { data, error } = await sb.from('email_events')
    .select('event_type, url, email_hash, created_at')
    .eq('schedule_id', scheduleId);
  if(error) return res.status(400).json({ error: error.message });

  const openEvents  = data.filter(e => e.event_type === 'open');
  const clickEvents = data.filter(e => e.event_type === 'click');
  const opens  = new Set(openEvents.map(e => e.email_hash)).size;
  const clicks = new Set(clickEvents.map(e => e.email_hash)).size;
  const totalClicks = clickEvents.length;

  // URL별 클릭 집계 — hotel_id 추출
  const urlMap = {};
  clickEvents.forEach(e => {
    const key = e.url || '-';
    urlMap[key] = (urlMap[key] || 0) + 1;
  });
  const urlStats = Object.entries(urlMap)
    .sort((a, b) => b[1] - a[1])
    .map(([url, count]) => {
      const hotelMatch = url.match(/\/hotels\/(\d+)/);
      return { url, count, hotel_id: hotelMatch ? hotelMatch[1] : null };
    });

  // hotel_id 있는 것들 이름 일괄 조회
  const hotelIds = [...new Set(urlStats.filter(u => u.hotel_id).map(u => u.hotel_id))];
  const hotelNames = {};
  if(hotelIds.length > 0) {
    try {
      const sql = `SELECT hotel_id, name_kr FROM tripbtoz.hotels WHERE hotel_id IN (${hotelIds.map(id => pool.escape(id)).join(',')})`;
      const result = await runQuery(sql);
      if(result.type === 'select') {
        const idIdx   = result.columns.map(c => c.toLowerCase()).indexOf('hotel_id');
        const nameIdx = result.columns.map(c => c.toLowerCase()).indexOf('name_kr');
        result.rows.forEach(r => { if(idIdx >= 0 && nameIdx >= 0) hotelNames[String(r[idIdx])] = r[nameIdx]; });
      }
    } catch(_) {}
  }

  res.json({ opens, clicks, totalClicks, urlStats, hotelNames });
});

// 캠페인 통계 CSV 다운로드
app.get('/api/campaign-stats/:scheduleId/csv', async (req, res) => {
  const { scheduleId } = req.params;
  const { data: schedule } = await sb.from('email_schedules').select('subject, sent_count').eq('id', scheduleId).single();
  const { data, error } = await sb.from('email_events')
    .select('event_type, url, email_hash, created_at')
    .eq('schedule_id', scheduleId);
  if(error) return res.status(400).send('error');

  const rows = [['이벤트', '이메일(해시)', 'URL', '시간']];
  for(const e of data) {
    rows.push([e.event_type, e.email_hash || '', e.url || '', e.created_at || '']);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const subject = schedule?.subject || scheduleId;
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="stats_${subject.slice(0,20).replace(/[^a-zA-Z0-9가-힣]/g,'_')}_${scheduleId}.csv"`,
  });
  res.send('\uFEFF' + csv); // BOM for Excel
});

// 호텔 스마트 조회
app.post('/api/hotels/smart-pick', async (req, res) => {
  const { city, rankBy = 'bookings', limit = 6 } = req.body;
  if(!city) return res.status(400).json({ error: 'city 필수' });

  const safeLimit = Math.min(parseInt(limit) || 6, 20);

  // rankBy: 'bookings' | 'revenue' | 'price'
  // 예약건수/매출 기준 쿼리는 실제 DB 스키마에 맞게 수정 필요
  const orderMap = {
    bookings: 'booking_cnt DESC',
    revenue:  'revenue DESC',
    price:    'min_price ASC',
  };

  const sql = `
    SELECT hotel_id, name_kr, city_kr, min_price
    FROM tripbtoz.hotels
    WHERE city_kr = ${pool.escape(city)}
      AND min_price IS NOT NULL AND min_price > 0
    ORDER BY min_price ASC
    LIMIT ${safeLimit}`;

  try {
    const qResult = await runQuery(sql);
    if(qResult.type !== 'select' || !qResult.rows.length) return res.json({ hotels: [] });

    const cols = qResult.columns.map(c => c.toLowerCase());
    const hotelIdIdx   = cols.indexOf('hotel_id');
    const nameIdx      = cols.findIndex(c => ['name_kr','name_ko','name'].includes(c));
    const cityIdx      = cols.indexOf('city_kr');
    const minPriceIdx  = cols.indexOf('min_price');

    const hotels = qResult.rows.slice(0, safeLimit).map(r => ({
      hotel_id:     hotelIdIdx  >= 0 ? r[hotelIdIdx]  : null,
      name_kr:      nameIdx     >= 0 ? r[nameIdx]     : '',
      city_kr:      cityIdx     >= 0 ? r[cityIdx]     : '',
      db_min_price: minPriceIdx >= 0 ? (r[minPriceIdx] ? Math.round(parseFloat(String(r[minPriceIdx]))) : null) : null,
      price_available: false,
    }));

    // 가격 API 병렬 조회
    const serverBase = process.env.SERVER_URL || 'http://localhost:3001';
    await Promise.all(hotels.map(async h => {
      if(!h.hotel_id) return;
      try {
        const p = await fetch(`${serverBase}/api/hotel-price/${h.hotel_id}`, { signal: AbortSignal.timeout(6000) }).then(r => r.json());
        if(p.available) {
          h.price_available = true;
          h.discounted_price = p.discounted_price;
          h.regular_price    = p.regular_price;
          h.discount_rate    = p.discount_rate;
        }
      } catch(_) {}
    }));

    const { checkIn, checkOut } = getNextMondayDates();
    const result = hotels
      .filter(h => h.price_available || h.db_min_price)
      .map(h => ({
        name:     h.name_kr,
        area:     h.city_kr,
        price:    h.discounted_price || h.db_min_price || '',
        discount: h.discount_rate    || '',
        img:      '',
        link:     h.hotel_id
          ? `https://www.tripbtoz.com/hotels/${h.hotel_id}?check-in=${checkIn}&check-out=${checkOut}&rooms=1&room-0-adults=2&room-0-children=0&searchId=${h.hotel_id}&searchType=HOTEL`
          : '',
      }));

    res.json({ hotels: result });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

// AI 이메일 생성
app.post('/api/ai-generate', async (req, res) => {
  const apiKey = process.env.LLM_GATEWAY_API_KEY;
  const gatewayUrl = process.env.LLM_GATEWAY_URL || 'https://llm-gateway.tbz.kr';
  if(!apiKey) return res.status(400).json({ error: 'LLM_GATEWAY_API_KEY가 설정되지 않았습니다' });

  const { prompt, type, vars } = req.body;
  if(!prompt) return res.status(400).json({ error: 'prompt 필수' });

  const isTransactional = type === 'transactional';

  const systemPrompt = isTransactional
    ? `트립비토즈 호텔 예약 서비스의 트랜잭셔널 이메일 템플릿을 생성해주세요.

사용자 요청: ${prompt}

다음 JSON 형식으로만 응답해주세요 (다른 텍스트 없이):
{
  "subject": "이메일 제목",
  "blocks": [
    { "type": "title", "data": { "text": "..." } },
    { "type": "text", "data": { "text": "..." } },
    { "type": "reservation", "data": {
        "title": "예약 내역",
        "rows": [
          { "label": "한국어 라벨", "value": "{{변수명}}" }
        ],
        "ctaText": "예약 확인하기",
        "ctaLink": "https://www.tripbtoz.com"
    }},
    { "type": "notice", "data": { "n1": "...", "n2": "..." } }
  ]
}

사용 가능한 블록 타입: title, subtitle, text, highlight, reservation, cta, divider, notice
- title: { text }
- text: { text }
- reservation: { title, rows: [{label, value}], ctaText, ctaLink }
- cta: { text, link }
- notice: { n1, n2 }

규칙:
- reservation 블록 반드시 포함, rows에 제공된 변수 전부 적절한 한국어 라벨로 배치
- 로고/푸터 블록 포함하지 말 것 (자동으로 추가됨)
- 변수는 반드시 {{변수명}} 형태 유지
- 제공된 변수 목록: ${(vars||[]).map(v => '{{'+v+'}}').join(', ')}`
    : `트립비토즈 호텔 예약 서비스의 마케팅 이메일을 생성해주세요.

사용자 요청: ${prompt}

다음 JSON 형식으로만 응답해주세요 (다른 텍스트 없이):
{
  "subject": "이메일 제목",
  "blocks": [
    { "type": "title", "data": { "text": "..." } },
    { "type": "text", "data": { "text": "..." } },
    { "type": "cta", "data": { "text": "버튼 텍스트", "url": "https://www.tripbtoz.com" } }
  ]
}

사용 가능한 블록 타입: title, subtitle, text, highlight, cta, divider, notice
- title: { text }
- subtitle: { text, size }
- text: { text }
- highlight: { text }
- cta: { text, url }
- divider: {}
- notice: { text }

로고 블록과 푸터 블록은 포함하지 마세요. 본문 내용 블록만 생성하세요.`;

  try {
    const response = await fetch(`${gatewayUrl}/v1/proxy/bedrock/converse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        modelId: 'apac.anthropic.claude-sonnet-4-20250514-v1:0',
        system: [{ text: systemPrompt }],
        messages: [{ role: 'user', content: [{ text: '위 지시에 따라 JSON만 출력해주세요.' }] }],
        inferenceConfig: { maxTokens: 2048 },
      }),
    });

    const aiData = await response.json();
    const content = aiData.output?.message?.content?.[0]?.text;
    if(!content) return res.status(500).json({ error: 'AI 응답 없음', detail: aiData });

    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
    res.json(parsed);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// 발송 진행 상황 조회
app.get('/api/send-job/:jobId', (req, res) => {
  const job = sendJobs[req.params.jobId];
  if(!job) return res.status(404).json({ error: 'job not found' });
  res.json(job);
});

// 호텔 차주 최저가 조회 (내부 pop-api 프록시)
app.get('/api/hotel-price/:hotelId', async (req, res) => {
  const { hotelId } = req.params;

  // 차주 월요일 ~ 화요일 (1박)
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const daysToMonday = (8 - day) % 7 || 7;
  const checkIn  = new Date(now); checkIn.setDate(now.getDate() + daysToMonday);
  const checkOut = new Date(checkIn); checkOut.setDate(checkIn.getDate() + 1);
  const fmt = d => d.toISOString().split('T')[0];

  const url = `${process.env.TRIPBTOZ_API}/v3/hotels/${hotelId}/rooms/rates`;
  const body = {
    check_in:    fmt(checkIn),
    check_out:   fmt(checkOut),
    meta_source: 'TBZ_DIRECT',
    rooms: [{ no: 0, adults: 2, children: [] }],
    commission:  true,
    cacheable:   true,
  };
  console.log(`[hotel-price] → ${url}`, JSON.stringify(body));

  try {
    const apiRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': 'ko-KR',
        'x-ua-timezone': 'Asia/Seoul',
        'x-tbz-app-platform': 'IOS',
        'x-tbz-app-version': '3.6.7',
        'x-user-id': '1768205',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    console.log(`[hotel-price] ← ${hotelId} status: ${apiRes.status}`);

    if(!apiRes.ok) {
      const errText = await apiRes.text();
      console.log(`[hotel-price] ← ${hotelId} error body: ${errText}`);
      return res.json({ available: false });
    }

    const data = await apiRes.json();
    console.log(`[hotel-price] ← ${hotelId} items: ${(data.items||[]).length}`);

    let minRate = null;
    for(const item of (data.items || [])) {
      for(const rate of (item.rates || [])) {
        if(rate.discounted_price > 0 && (!minRate || rate.discounted_price < minRate.discounted_price)) {
          minRate = { regular_price: rate.regular_price, discounted_price: rate.discounted_price, currency: rate.currency || 'KRW' };
        }
      }
    }
    if(!minRate) {
      console.log(`[hotel-price] ← ${hotelId} no valid rates`);
      return res.json({ available: false });
    }

    const discount_rate = minRate.regular_price > 0
      ? Math.round((1 - minRate.discounted_price / minRate.regular_price) * 100)
      : 0;
    console.log(`[hotel-price] ← ${hotelId} 최저가: ${minRate.discounted_price} (${discount_rate}% 할인)`);
    res.json({ available: true, ...minRate, discount_rate, check_in: fmt(checkIn), check_out: fmt(checkOut) });
  } catch(e) {
    console.error(`[hotel-price] ← ${hotelId} 예외: ${e.message}`);
    res.json({ available: false, error: e.message });
  }
});

// AI 시즌 프로모션 자동 생성 (국내2+해외2 여행지별 DB 호텔 + LLM 텍스트)
app.post('/api/ai/season-generate', async (req, res) => {
  const apiKey = process.env.LLM_GATEWAY_API_KEY;
  const gatewayUrl = process.env.LLM_GATEWAY_URL || 'https://llm-gateway.tbz.kr';
  if(!apiKey) return res.status(400).json({ error: 'LLM_GATEWAY_API_KEY가 설정되지 않았습니다' });

  const now = new Date();
  const nextMonthIdx = (now.getMonth() + 1) % 12; // 0-based
  const lastYear = now.getFullYear() - 1;
  const actualNextMonth = nextMonthIdx + 1; // 1-based, for SQL
  const KO_MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const monthName = KO_MONTHS[nextMonthIdx];

  async function callLLM(systemPrompt, maxTokens = 1024) {
    const r = await fetch(`${gatewayUrl}/v1/proxy/bedrock/converse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({
        modelId: 'apac.anthropic.claude-sonnet-4-20250514-v1:0',
        system: [{ text: systemPrompt }],
        messages: [{ role: 'user', content: [{ text: 'JSON만 출력해주세요.' }] }],
        inferenceConfig: { maxTokens },
      }),
    });
    const d = await r.json();
    const text = d.output?.message?.content?.[0]?.text || '';
    return JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
  }

  async function getHotelsForCity(dest) {
    let whereClause;
    let fallbackWhereClause = null; // city 필터 결과 부족 시 country_code만으로 재시도
    if(dest.type === 'domestic') {
      whereClause = `h.city_kr LIKE ${pool.escape('%' + dest.cityKeyword + '%')}`;
    } else {
      // 국가코드 + 영문/한글 도시명 필터 (country_code만 쓰면 도쿄→오키나와 혼입 등 문제)
      const cityConditions = [];
      if(dest.cityEn)      cityConditions.push(`h.city LIKE ${pool.escape('%' + dest.cityEn + '%')}`);
      if(dest.cityKeyword) cityConditions.push(`h.city_kr LIKE ${pool.escape('%' + dest.cityKeyword + '%')}`);
      const cityFilter = cityConditions.length > 0 ? `(${cityConditions.join(' OR ')})` : null;
      whereClause = cityFilter
        ? `h.country_code = ${pool.escape(dest.countryCode)} AND ${cityFilter}`
        : `h.country_code = ${pool.escape(dest.countryCode)}`;
      // 발리/푸켓처럼 도시가 서브지역으로 분산된 경우 fallback
      fallbackWhereClause = `h.country_code = ${pool.escape(dest.countryCode)}`;
    }

    const serverBase = process.env.SERVER_URL || 'http://localhost:3001';
    const { checkIn, checkOut } = getNextMondayDates();
    const seenIds = new Set();
    const result = [];
    let offset = 0;
    const batchSize = 10;

    while(result.length < 4) {
      const sql = `
        SELECT h.hotel_id, h.name_kr, h.city_kr, h.address1, h.address2, h.country_code, h.country_kr, MAX(ac.thumbnail) AS thumbnail, COUNT(*) AS booking_cnt
        FROM tripbtoz.hotels h
        JOIN tripbtoz.bookings b ON b.hotel_id = h.hotel_id
        LEFT JOIN tripbtoz_meta.accommodation_common ac ON ac.id = h.hotel_id
        WHERE MONTH(b.check_in) = ${actualNextMonth}
          AND YEAR(b.check_in) = ${lastYear}
          AND ${whereClause}
        GROUP BY h.hotel_id, h.name_kr, h.city_kr, h.address1, h.address2, h.country_code, h.country_kr
        ORDER BY booking_cnt DESC
        LIMIT ${batchSize} OFFSET ${offset}`;


      let dbResult;
      try { dbResult = await runQuery(sql); } catch(_) { break; }
      if(dbResult.type !== 'select' || !dbResult.rows.length) break;

      const cols = dbResult.columns.map(c => c.toLowerCase());
      const hotelIdIdx     = cols.indexOf('hotel_id');
      const nameIdx        = cols.findIndex(c => ['name_kr','name_ko','name'].includes(c));
      const cityIdx        = cols.indexOf('city_kr');
      const addr1Idx       = cols.indexOf('address1');
      const addr2Idx       = cols.indexOf('address2');
      const countryCodeIdx = cols.indexOf('country_code');
      const countryKrIdx   = cols.indexOf('country_kr');
      const thumbIdx       = cols.indexOf('thumbnail');

      const batch = dbResult.rows
        .map(r => ({
          hotel_id:     hotelIdIdx     >= 0 ? r[hotelIdIdx]     : null,
          name_kr:      nameIdx        >= 0 ? r[nameIdx]        : '',
          city_kr:      cityIdx        >= 0 ? r[cityIdx]        : '',
          address1:     addr1Idx       >= 0 ? r[addr1Idx]       : '',
          address2:     addr2Idx       >= 0 ? r[addr2Idx]       : '',
          country_code: countryCodeIdx >= 0 ? r[countryCodeIdx] : '',
          country_kr:   countryKrIdx   >= 0 ? r[countryKrIdx]   : '',
          thumbnail:    thumbIdx       >= 0 ? r[thumbIdx]        : '',
          price_available: false,
        }))
        .filter(h => h.hotel_id && !seenIds.has(h.hotel_id));

      batch.forEach(h => seenIds.add(h.hotel_id));

      // 가격 API 병렬 조회
      await Promise.all(batch.map(async h => {
        try {
          const p = await fetch(`${serverBase}/api/hotel-price/${h.hotel_id}`, { signal: AbortSignal.timeout(6000) }).then(r => r.json());
          if(p.available) { h.price_available = true; h.discounted_price = p.discounted_price; h.regular_price = p.regular_price; h.discount_rate = p.discount_rate; }
        } catch(_) {}
      }));

      const priced = batch.filter(h => h.price_available);
      result.push(...priced);

      // 결과가 충분하거나 더 이상 DB에 없으면 종료
      if(dbResult.rows.length < batchSize) break;
      offset += batchSize;
    }

    // 도시 필터로 4개 못 채운 경우 (발리/푸켓 등 서브지역 분산 목적지) → country fallback
    if(result.length < 4 && fallbackWhereClause && fallbackWhereClause !== whereClause) {
      console.log(`[season] ${dest.name}: city 필터로 ${result.length}개만 확보, country fallback 시도`);
      const fallbackOffset = 0;
      let fbOffset = 0;
      while(result.length < 4) {
        const sql = `
          SELECT h.hotel_id, h.name_kr, h.city_kr, h.address1, h.address2, h.country_code, h.country_kr, MAX(ac.thumbnail) AS thumbnail, COUNT(*) AS booking_cnt
          FROM tripbtoz.hotels h
          JOIN tripbtoz.bookings b ON b.hotel_id = h.hotel_id
          LEFT JOIN tripbtoz_meta.accommodation_common ac ON ac.id = h.hotel_id
          WHERE MONTH(b.check_in) = ${actualNextMonth}
            AND YEAR(b.check_in) = ${lastYear}
            AND ${fallbackWhereClause}
          GROUP BY h.hotel_id, h.name_kr, h.city_kr, h.address1, h.address2, h.country_code, h.country_kr
          ORDER BY booking_cnt DESC
          LIMIT ${batchSize} OFFSET ${fbOffset}`;
        let fbResult;
        try { fbResult = await runQuery(sql); } catch(_) { break; }
        if(fbResult.type !== 'select' || !fbResult.rows.length) break;
        const cols = fbResult.columns.map(c => c.toLowerCase());
        const batch = fbResult.rows.map(r => ({
          hotel_id:     cols.indexOf('hotel_id')     >= 0 ? r[cols.indexOf('hotel_id')]     : null,
          name_kr:      cols.findIndex(c => ['name_kr','name_ko','name'].includes(c)) >= 0 ? r[cols.findIndex(c => ['name_kr','name_ko','name'].includes(c))] : '',
          city_kr:      cols.indexOf('city_kr')      >= 0 ? r[cols.indexOf('city_kr')]      : '',
          address1:     cols.indexOf('address1')     >= 0 ? r[cols.indexOf('address1')]     : '',
          address2:     cols.indexOf('address2')     >= 0 ? r[cols.indexOf('address2')]     : '',
          country_code: cols.indexOf('country_code') >= 0 ? r[cols.indexOf('country_code')] : '',
          country_kr:   cols.indexOf('country_kr')   >= 0 ? r[cols.indexOf('country_kr')]   : '',
          thumbnail:    cols.indexOf('thumbnail')    >= 0 ? r[cols.indexOf('thumbnail')]    : '',
          price_available: false,
        })).filter(h => h.hotel_id && !seenIds.has(h.hotel_id));
        batch.forEach(h => seenIds.add(h.hotel_id));
        await Promise.all(batch.map(async h => {
          try {
            const p = await fetch(`${serverBase}/api/hotel-price/${h.hotel_id}`, { signal: AbortSignal.timeout(6000) }).then(r => r.json());
            if(p.available) { h.price_available = true; h.discounted_price = p.discounted_price; h.regular_price = p.regular_price; h.discount_rate = p.discount_rate; }
          } catch(_) {}
        }));
        result.push(...batch.filter(h => h.price_available));
        if(fbResult.rows.length < batchSize) break;
        fbOffset += batchSize;
      }
    }

    // 국가코드 → 국기 이모지 (예: 'KR' → '🇰🇷')
    function toFlagEmoji(code) {
      if (!code || code.length !== 2) return '';
      return [...code.toUpperCase()].map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');
    }

    // 도시명 추출
    function extractCity(city_kr, address1, destName) {
      const isCountryCode = /^[A-Z]{2,4}$/.test(city_kr || '');
      if (!isCountryCode && city_kr && city_kr.trim().length > 0) return city_kr.trim();
      if (address1 && /[가-힣]/.test(address1)) {
        const parts = address1.trim().split(/\s+/);
        return parts.slice(0, 2).join(' ');
      }
      return destName || '';
    }

    // 최종 표시: 🇰🇷 대한민국 · 서울 강남구 / 🇯🇵 일본 · 도쿄
    function buildArea(city_kr, address1, address2, country_code, country_kr, destName) {
      const flag    = toFlagEmoji(country_code);
      const country = country_kr && !/^[A-Z]{2,4}$/.test(country_kr) ? country_kr : '';
      const city    = extractCity(city_kr, address1, destName);
      const parts   = [country, city].filter(Boolean);
      return flag ? `${flag} ${parts.join(' · ')}` : parts.join(' · ');
    }

    return result.slice(0, 4).map(h => ({
      name:          h.name_kr,
      area:          buildArea(h.city_kr, h.address1, h.address2, h.country_code, h.country_kr, dest.name),
      price:         h.discounted_price || '',
      regularPrice:  h.regular_price    || '',
      discount:      h.discount_rate    || '',
      img:           h.thumbnail        || '',
      link:     h.hotel_id ? `https://www.tripbtoz.com/hotels/${h.hotel_id}?check-in=${checkIn}&check-out=${checkOut}&rooms=1&room-0-adults=2&room-0-children=0&searchId=${h.hotel_id}&searchType=HOTEL` : '',
    }));
  }

  try {
    // Step 1. 이번 달 이미 발송한 여행지 조회
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const { data: historyRows } = await sb
      .from('season_destination_history')
      .select('destination_name')
      .eq('year_month', yearMonth);
    const usedDestinations = (historyRows || []).map(r => r.destination_name);
    const excludeNote = usedDestinations.length > 0
      ? `\n\n⚠️ 이번 달(${monthName})에 이미 추천한 여행지: [${usedDestinations.join(', ')}]\n반드시 위 여행지는 제외하고 새로운 여행지를 선정해주세요.`
      : '';

    // Step 2. LLM: 여행지 4곳 선정 (국내2 + 해외2) + 설명
    const destinations = await callLLM(
      `트립비토즈 호텔 예약 서비스 이메일 마케터입니다.
${monthName}에 여행하기 좋은 여행지를 국내 2곳, 해외 2곳 총 4곳을 선정해주세요.
해외 여행지는 ISO 2자리 countryCode도 포함해주세요 (일본=JP, 태국=TH, 베트남=VN, 싱가포르=SG, 미국=US, 프랑스=FR 등).${excludeNote}

다음 JSON 형식으로만 응답하세요:
{
  "subject": "이메일 제목 (50자 이내)",
  "titleText": "이메일 헤드라인 (30자 이내)",
  "introText": "전체 소개 문구 (2문장)",
  "destinations": [
    { "name": "제주도", "type": "domestic", "cityKeyword": "제주", "description": "여행지 소개 3~4문장. 계절감, 추천 활동, 분위기를 담아 이메일 독자가 여행을 상상할 수 있게 작성" },
    { "name": "부산", "type": "domestic", "cityKeyword": "부산", "description": "여행지 소개 3~4문장. 계절감, 추천 활동, 분위기를 담아 이메일 독자가 여행을 상상할 수 있게 작성" },
    { "name": "도쿄", "type": "international", "countryCode": "JP", "cityEn": "Tokyo", "cityKeyword": "도쿄", "description": "여행지 소개 3~4문장. 계절감, 추천 활동, 분위기를 담아 이메일 독자가 여행을 상상할 수 있게 작성" },
    { "name": "방콕", "type": "international", "countryCode": "TH", "cityEn": "Bangkok", "cityKeyword": "방콕", "description": "여행지 소개 3~4문장. 계절감, 추천 활동, 분위기를 담아 이메일 독자가 여행을 상상할 수 있게 작성" }
  ]
}`, 2500);

    // Step 3. 여행지별 DB 호텔 병렬 조회
    const hotelsByDest = await Promise.all(
      destinations.destinations.map(d => getHotelsForCity(d))
    );

    // Step 4. 블록 조립
    const blocks = [{ type: 'logo', data: {} }];
    blocks.push({ type: 'title', data: { text: destinations.titleText || `${monthName} 추천 여행지` } });
    blocks.push({ type: 'text',  data: { text: destinations.introText || '' } });

    destinations.destinations.forEach((dest, i) => {
      const flag = dest.type === 'domestic' ? '🇰🇷' : '✈️';
      blocks.push({ type: 'subtitle', data: { text: `${flag} ${dest.name}`, size: 'medium' } });
      blocks.push({ type: 'text',     data: { text: dest.description || '' } });
      blocks.push({ type: 'hotels',   data: { hotels: hotelsByDest[i] || [] } });
    });

    blocks.push({ type: 'footer', data: { footerType: 'marketing' } });

    // Step 5. 이번 발송 여행지 기록 저장
    const toInsert = destinations.destinations.map(d => ({
      year_month:        yearMonth,
      destination_name:  d.name,
      destination_type:  d.type,
      country_code:      d.countryCode || null,
      city_keyword:      d.cityKeyword || null,
      city_en:           d.cityEn || null,
    }));
    await sb.from('season_destination_history').insert(toInsert);

    const usedCount = usedDestinations.length;
    res.json({
      subject: destinations.subject || `${monthName} 인기 여행지 호텔 특가`,
      blocks,
      meta: { yearMonth, usedBefore: usedDestinations, newDestinations: destinations.destinations.map(d => d.name), sendCount: Math.floor(usedCount / 4) + 1 },
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════
// EXTERNAL TRIGGER API
// POST /api/trigger
// Body: { event, secret, email, data: { key: value, ... } }
// ═══════════════════════════════════════════
app.post('/api/trigger', async (req, res) => {
  const { event, secret, email, data = {} } = req.body;

  // 1. 필수값 체크
  if(!event || !email) return res.status(400).json({ error: 'event, email 필수' });

  // 2. 시크릿 검증
  const TRIGGER_SECRET = process.env.TRIGGER_SECRET;
  if(TRIGGER_SECRET && secret !== TRIGGER_SECRET) {
    return res.status(401).json({ error: '유효하지 않은 secret' });
  }

  try {
    // 3. trigger_mappings 조회
    const { data: mapping, error: mapErr } = await sb
      .from('trigger_mappings')
      .select('template_id, is_active')
      .eq('event_name', event)
      .single();

    if(mapErr || !mapping) return res.status(404).json({ error: `이벤트 '${event}' 매핑 없음` });
    if(!mapping.is_active) return res.status(400).json({ error: `이벤트 '${event}' 비활성 상태` });

    // 4. 템플릿 조회
    const { data: tpl, error: tplErr } = await sb
      .from('templates')
      .select('html, name')
      .eq('id', mapping.template_id)
      .single();

    if(tplErr || !tpl) return res.status(404).json({ error: '템플릿을 찾을 수 없음' });

    // 5. 수신거부 체크
    const { data: unsubs } = await sb.from('unsubscribers').select('email');
    const unsubSet = new Set((unsubs || []).map(u => u.email.toLowerCase()));
    if(unsubSet.has(email.toLowerCase())) {
      return res.status(400).json({ error: '수신거부 이메일' });
    }

    // 6. 변수 치환 (data 객체의 key/value + 기본 변수들)
    const vars = {
      ...data,
      UNSUB_URL: getUnsubUrl(email),
      UNSUBSCRIBE_URL: getUnsubUrl(email),
    };

    let html = tpl.html;
    for(const [k, v] of Object.entries(vars)) {
      html = html.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v ?? ''));
    }

    // 7. 풀 HTML 래핑
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"><style>*{font-family:'Pretendard','Malgun Gothic','맑은 고딕',Apple SD Gothic Neo,sans-serif!important}</style></head><body style="margin:0;padding:0;background:#f5f5f5;"><table cellpadding="0" cellspacing="0" width="100%" style="background:#f5f5f5;"><tr><td align="center" style="padding:20px 0;"><div style="width:600px;max-width:100%;margin:0 auto;background:#fff;">${html}</div></td></tr></table></body></html>`;

    // 8. SES 발송
    const subject = data.subject || tpl.name || `[트립비토즈] ${event}`;
    const from = `${process.env.SES_FROM_NAME || '트립비토즈'} <${process.env.SES_FROM_EMAIL}>`;

    await ses.send(new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: { Html: { Data: fullHtml, Charset: 'UTF-8' } },
      },
    }));

    console.log(`[trigger] event=${event} → ${email} 발송 완료`);
    res.json({ ok: true, event, email, template: tpl.name });

  } catch(e) {
    console.error(`[trigger] error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// secret key 조회 (마스킹용)
app.get('/api/trigger-secret', (req, res) => {
  const secret = process.env.TRIGGER_SECRET;
  res.json({ value: secret || null });
});

// trigger_mappings CRUD
app.get('/api/trigger-mappings', async (req, res) => {
  const { data, error } = await sb.from('trigger_mappings').select('*, templates(name)').order('created_at', { ascending: false });
  if(error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post('/api/trigger-mappings', async (req, res) => {
  const { event_name, template_id, is_active } = req.body;
  if(!event_name || !template_id) return res.status(400).json({ error: 'event_name, template_id 필수' });
  const { data, error } = await sb.from('trigger_mappings').insert({ event_name, template_id, is_active: is_active !== false }).select().single();
  if(error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.put('/api/trigger-mappings/:id', async (req, res) => {
  const { event_name, template_id, is_active } = req.body;
  const update = {};
  if(event_name !== undefined) update.event_name = event_name;
  if(template_id !== undefined) update.template_id = template_id;
  if(is_active !== undefined) update.is_active = is_active;
  const { data, error } = await sb.from('trigger_mappings').update(update).eq('id', req.params.id).select().single();
  if(error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.delete('/api/trigger-mappings/:id', async (req, res) => {
  const { error } = await sb.from('trigger_mappings').delete().eq('id', req.params.id);
  if(error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

// ═══════════════════════════════════════════
// SCHEDULE EXECUTOR (1분마다 due 스케줄 처리)
// ═══════════════════════════════════════════
async function runDueSchedules() {
  try {
    const now = new Date();
    const { data: dues } = await sb.from('email_schedules')
      .select('*').eq('status', 'pending').eq('schedule_type', 'once')
      .lte('scheduled_at', now.toISOString());

    for(const s of (dues || [])) {
      if(!s.template_id) continue;
      const subject = s.subject || `[트립비토즈] ${s.template_name || '이메일'}`;
      const jobId = `sched_${s.id}`;
      sendJobs[jobId] = { status: 'running', sent: 0, failed: 0, total: 0, filtered: 0, errors: [] };
      console.log(`[scheduler] 발송 시작: ${s.template_name} → ${s.segment_name}`);
      executeSend(jobId, {
        templateId:    s.template_id,
        segmentId:     s.segment_id,
        segmentQuery:  s.segment_query,
        subject,
        scheduleId:    s.id,
        contentQuery:  s.content_query,
        contentLimit:  s.content_limit,
        utmCampaign:   s.utm_campaign,
      });
    }
  } catch(e) {
    console.error('[scheduler]', e.message);
  }
}

setInterval(runDueSchedules, 60 * 1000);

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API server running on port ${PORT}`);
  console.log(`[트래킹 URL] SERVER_URL = ${process.env.SERVER_URL || '⚠️  미설정 (localhost 사용 중)'}`);
});

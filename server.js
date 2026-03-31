require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const crypto = require('crypto');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
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
    SELECT DISTINCT c.user_email AS email
    FROM tripbtoz.checkouts c
    JOIN tripbtoz_payment.checkout_detail cd ON cd.checkout_id = c.id
    WHERE c.user_type = 'guest'
      AND cd.ad_policy_agreement_yn = 1
      AND c.user_email IS NOT NULL
      AND c.user_email != ''`,
  all: `
    SELECT DISTINCT email FROM tripbtoz.users_0519 WHERE mkt_email_agree = 1 AND status = 'AT' AND email IS NOT NULL AND email != ''
    UNION
    SELECT DISTINCT c.user_email FROM tripbtoz.checkouts c
    JOIN tripbtoz_payment.checkout_detail cd ON cd.checkout_id = c.id
    WHERE c.user_type = 'guest'
      AND cd.ad_policy_agreement_yn = 1
      AND c.user_email IS NOT NULL
      AND c.user_email != ''`,
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

// 도시 검색 자동완성
app.get('/api/cities', async (req, res) => {
  const q = (req.query.q || '').trim();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT DISTINCT city_kr FROM hotels WHERE city_kr LIKE ? AND city_kr IS NOT NULL AND city_kr != '' ORDER BY city_kr LIMIT 20`,
      [`%${q}%`]
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

function buildHotelUrl(h, utmCampaign) {
  const base = 'https://www.tripbtoz.com/hotels';
  const checkIn  = h.check_in  || '';
  const checkOut = h.check_out || '';
  const query = encodeURIComponent(h.name_kr || h.name || '');
  const utm = utmCampaign ? `&utm_source=email&utm_medium=newsletter&utm_campaign=${encodeURIComponent(utmCampaign)}` : '';
  return `${base}/${h.hotel_id}?check-in=${checkIn}&check-out=${checkOut}&rooms=1&room-0-adults=2&room-0-children=0&query=${query}&searchId=${h.hotel_id}&searchType=HOTEL${utm}`;
}

function renderHotelCardsHtml(hotels, utmCampaign) {
  if(!hotels.length) return '';
  const cards = hotels.map(h => {
    const stars = '★'.repeat(Math.floor(parseFloat(h.star_rating) || 0));
    const url = h.hotel_id ? buildHotelUrl(h, utmCampaign) : '#';
    const discountBadge = h.price_available && h.discount_rate > 0
      ? `<span style="font-size:11px;color:#f43f5e;background:#fff0f3;padding:2px 7px;border-radius:10px;font-weight:600;">-${h.discount_rate}%</span>`
      : '';
    const priceHtml = h.price_available
      ? `<p style="margin:8px 0 0;font-size:15px;color:#7B3CFF;font-weight:700;">${String(h.discounted_price||0).replace(/\B(?=(\d{3})+(?!\d))/g,',')} 원~ ${discountBadge}</p>
         <p style="margin:2px 0 0;font-size:11px;color:#bbb;text-decoration:line-through;">${String(h.regular_price||0).replace(/\B(?=(\d{3})+(?!\d))/g,',')} 원</p>`
      : `<p style="margin:8px 0 0;font-size:15px;color:#ddd;font-weight:700;">가격 정보 없음</p>
         <p style="margin:2px 0 0;font-size:11px;color:transparent;">-</p>`;
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
  const hotelIdIdx = result.columns.findIndex(c => c.toLowerCase() === 'hotel_id' || c.toLowerCase() === 'id');
  const nameIdx    = result.columns.findIndex(c => ['name_kr','name_ko','name'].includes(c.toLowerCase()));
  const cityIdx    = result.columns.findIndex(c => c.toLowerCase() === 'city_kr');
  const starIdx    = result.columns.findIndex(c => c.toLowerCase() === 'star_rating');

  const hotels = result.rows.slice(0, contentLimit || 6).map(r => ({
    hotel_id:   hotelIdIdx >= 0 ? r[hotelIdIdx] : null,
    name_kr:    nameIdx    >= 0 ? r[nameIdx]    : '',
    city_kr:    cityIdx    >= 0 ? r[cityIdx]    : '',
    star_rating: starIdx   >= 0 ? r[starIdx]    : '',
    price_available: false,
  }));

  // 호텔 가격 병렬 조회
  if(hotelIdIdx >= 0) {
    await Promise.all(hotels.map(async h => {
      try {
        const res = await fetch(`http://localhost:3001/api/hotel-price/${h.hotel_id}`, { signal: AbortSignal.timeout(8000) });
        const p = await res.json();
        h.check_in  = p.check_in  || '';
        h.check_out = p.check_out || '';
        if(p.available) {
          h.price_available  = true;
          h.discounted_price = p.discounted_price;
          h.regular_price    = p.regular_price;
          h.discount_rate    = p.discount_rate;
        }
      } catch(e) { /* 가격 조회 실패는 무시 */ }
    }));
  }

  console.log(`[content] 호텔 ${hotels.length}개 렌더링`);
  return { ...vars, HOTEL_CARDS: renderHotelCardsHtml(hotels, contentLimit?._utmCampaign) };
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

  const hotelIdIdx = result.columns.findIndex(c => c.toLowerCase() === 'hotel_id' || c.toLowerCase() === 'id');
  const nameIdx    = result.columns.findIndex(c => ['name_kr','name_ko','name'].includes(c.toLowerCase()));
  const cityIdx    = result.columns.findIndex(c => c.toLowerCase() === 'city_kr');
  const starIdx    = result.columns.findIndex(c => c.toLowerCase() === 'star_rating');

  const hotels = result.rows.slice(0, contentLimit || 6).map(r => ({
    hotel_id:    hotelIdIdx >= 0 ? r[hotelIdIdx] : null,
    name_kr:     nameIdx    >= 0 ? r[nameIdx]    : '',
    city_kr:     cityIdx    >= 0 ? r[cityIdx]    : '',
    star_rating: starIdx    >= 0 ? r[starIdx]    : '',
    price_available: false,
    check_in: '', check_out: '',
  }));

  if(hotelIdIdx >= 0) {
    await Promise.all(hotels.map(async h => {
      try {
        const res = await fetch(`http://localhost:3001/api/hotel-price/${h.hotel_id}`, { signal: AbortSignal.timeout(8000) });
        const p = await res.json();
        h.check_in  = p.check_in  || '';
        h.check_out = p.check_out || '';
        if(p.available) {
          h.price_available  = true;
          h.discounted_price = p.discounted_price;
          h.regular_price    = p.regular_price;
          h.discount_rate    = p.discount_rate;
        }
      } catch(e) {}
    }));
  }

  console.log(`[content] 호텔 ${hotels.length}개 렌더링 (UTM: ${utmCampaign || 'none'})`);
  return { ...vars, HOTEL_CARDS: renderHotelCardsHtml(hotels, utmCampaign) };
}

async function executeSend(jobId, { templateId, segmentId, segmentQuery, subject, fromName, scheduleId, contentQuery, contentLimit, utmCampaign, dryRun }) {
  const job = sendJobs[jobId];
  job.status = 'running';
  job.dryRun = !!dryRun;

  try {
    // 1. 템플릿 HTML 가져오기
    const { data: tpl, error: tplErr } = await sb.from('templates').select('html,name').eq('id', templateId).single();
    if(tplErr || !tpl) throw new Error('템플릿을 찾을 수 없습니다');

    // 2. 세그먼트 이메일 목록 (segmentQuery 있으면 DB에서 직접 조회, 없으면 저장된 세그먼트 사용)
    let emails = [];
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

    // 기본 HTML 렌더링 (동적 변수 치환)
    function renderHtml(baseHtml, email) {
      let html = baseHtml;
      for(const [k, v] of Object.entries(dynVars)) {
        html = html.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
      }
      html = html.replace(/\{\{UNSUB_URL\}\}/g, getUnsubUrl(email));
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f5f5f5;"><table cellpadding="0" cellspacing="0" width="100%" style="background:#f5f5f5;"><tr><td align="center" style="padding:20px 0;"><div style="width:600px;max-width:100%;margin:0 auto;background:#fff;">${html}</div></td></tr></table></body></html>`;
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
  const { templateId, segmentId, segmentQuery, subject, fromName, scheduleId, contentQuery, contentLimit, utmCampaign, dryRun } = req.body;
  if(!templateId || !subject) {
    return res.status(400).json({ error: 'templateId, subject 필수' });
  }
  if(!segmentId && !segmentQuery) {
    return res.status(400).json({ error: 'segmentId 또는 segmentQuery 필수' });
  }
  if(!dryRun && !process.env.AWS_ACCESS_KEY_ID) {
    return res.status(400).json({ error: 'AWS 자격증명이 .env에 설정되지 않았습니다' });
  }
  const jobId = `job_${Date.now()}`;
  sendJobs[jobId] = { status: 'running', sent: 0, failed: 0, total: 0, filtered: 0, errors: [] };
  executeSend(jobId, { templateId, segmentId, segmentQuery, subject, fromName, scheduleId, contentQuery, contentLimit, utmCampaign, dryRun });
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

    const hotelIdIdx = qResult.columns.findIndex(c => c.toLowerCase() === 'hotel_id' || c.toLowerCase() === 'id');
    const nameIdx    = qResult.columns.findIndex(c => ['name_kr','name_ko','name'].includes(c.toLowerCase()));
    const cityIdx    = qResult.columns.findIndex(c => c.toLowerCase() === 'city_kr');
    const starIdx    = qResult.columns.findIndex(c => c.toLowerCase() === 'star_rating');

    const hotels = qResult.rows.slice(0, contentLimit || 6).map(r => ({
      hotel_id:   hotelIdIdx >= 0 ? r[hotelIdIdx] : null,
      name_kr:    nameIdx    >= 0 ? r[nameIdx]    : '',
      city_kr:    cityIdx    >= 0 ? r[cityIdx]    : '',
      star_rating: starIdx   >= 0 ? r[starIdx]    : '',
      price_available: false,
    }));

    if(hotelIdIdx >= 0) {
      await Promise.all(hotels.map(async h => {
        try {
          const apiRes = await fetch(`http://localhost:3001/api/hotel-price/${h.hotel_id}`, { signal: AbortSignal.timeout(6000) });
          const p = await apiRes.json();
          if(p.available) { h.price_available = true; h.discounted_price = p.discounted_price; h.discount_rate = p.discount_rate; }
        } catch(e) {}
      }));
    }
    res.json({ hotels });
  } catch(e) {
    res.status(400).json({ error: e.message });
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

app.listen(3001, () => console.log('API server running on http://localhost:3001'));

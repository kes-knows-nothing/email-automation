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
  port: 40008,
  user: 'querypie',
  password: 'e70610b84f2719b1',
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
    FROM users
    WHERE mkt_email_agree = 1
      AND status NOT IN ('STOP', 'DEL')`,
  guest: `
    SELECT DISTINCT cd.origin_user_email AS email
    FROM tripbtoz_payment.checkout_detail cd
    WHERE cd.ad_policy_agreement_yn = 1
      AND cd.origin_user_email IS NOT NULL
      AND cd.origin_user_email != ''
      AND cd.checkout_id IN (
        SELECT id FROM tripbtoz.checkouts WHERE user_type = 'guest'
      )`,
  all: `
    SELECT DISTINCT email FROM tripbtoz.users WHERE mkt_email_agree = 1 AND status NOT IN ('STOP', 'DEL')
    UNION
    SELECT DISTINCT cd.origin_user_email FROM tripbtoz_payment.checkout_detail cd
    WHERE cd.ad_policy_agreement_yn = 1
      AND cd.origin_user_email IS NOT NULL
      AND cd.origin_user_email != ''
      AND cd.checkout_id IN (
        SELECT id FROM tripbtoz.checkouts WHERE user_type = 'guest'
      )`,
};

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24시간
const cache = {}; // { key: { rows, columns, total, cachedAt } }

async function runQuery(sql) {
  const conn = await pool.getConnection();
  try {
    const start = Date.now();
    const [rows, fields] = await conn.execute(sql);
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

async function executeSend(jobId, { templateId, segmentId, subject, fromName, scheduleId, dryRun }) {
  const job = sendJobs[jobId];
  job.status = 'running';
  job.dryRun = !!dryRun;

  try {
    // 1. 템플릿 HTML 가져오기
    const { data: tpl, error: tplErr } = await sb.from('templates').select('html,name').eq('id', templateId).single();
    if(tplErr || !tpl) throw new Error('템플릿을 찾을 수 없습니다');

    // 2. 세그먼트 이메일 목록
    let emails = [];
    if(segmentId) {
      const { data: seg, error: segErr } = await sb.from('segments').select('emails').eq('id', segmentId).single();
      if(segErr || !seg) throw new Error('세그먼트를 찾을 수 없습니다');
      emails = seg.emails || [];
    }

    // 3. 수신거부 필터링
    const { data: unsubs } = await sb.from('unsubscribers').select('email');
    const unsubSet = new Set((unsubs || []).map(u => u.email.toLowerCase()));
    const filtered = emails.filter(e => e && !unsubSet.has(e.toLowerCase()));

    job.total = filtered.length;
    job.filtered = emails.length - filtered.length;

    // DRY RUN: SES 호출 없이 결과 시뮬레이션
    if(dryRun) {
      job.preview = {
        subject,
        from: `${fromName || process.env.SES_FROM_NAME || '트립비토즈'} <${process.env.SES_FROM_EMAIL || 'no-reply@tripbtoz.com'}>`,
        sampleEmails: filtered.slice(0, 5),
        sampleUnsubUrl: filtered[0] ? getUnsubUrl(filtered[0]) : getUnsubUrl('test@example.com'),
        hasUnsubPlaceholder: tpl.html.includes('{{UNSUB_URL}}'),
      };
      await new Promise(r => setTimeout(r, 600)); // 로딩감 부여
      job.sent = filtered.length;
      job.status = 'done';
      return;
    }

    const from = `${fromName || process.env.SES_FROM_NAME || '트립비토즈'} <${process.env.SES_FROM_EMAIL}>`;

    // 4. 10개씩 배치 발송
    for(let i = 0; i < filtered.length; i += 10) {
      const batch = filtered.slice(i, i + 10);
      await Promise.all(batch.map(async email => {
        const unsubUrl = getUnsubUrl(email);
        const html = tpl.html.replace(/\{\{UNSUB_URL\}\}/g, unsubUrl);
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

    // 5. 스케줄 상태 업데이트
    if(scheduleId) {
      await sb.from('email_schedules').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        sent_count: job.sent,
      }).eq('id', scheduleId);
    }

    job.status = 'done';
  } catch(e) {
    job.status = 'error';
    job.errorMessage = e.message;
    console.error('[send]', e.message);
  }
}

// 발송 시작
app.post('/api/send', async (req, res) => {
  const { templateId, segmentId, subject, fromName, scheduleId, dryRun } = req.body;
  if(!templateId || !segmentId || !subject) {
    return res.status(400).json({ error: 'templateId, segmentId, subject 필수' });
  }
  if(!dryRun && !process.env.AWS_ACCESS_KEY_ID) {
    return res.status(400).json({ error: 'AWS 자격증명이 .env에 설정되지 않았습니다' });
  }
  const jobId = `job_${Date.now()}`;
  sendJobs[jobId] = { status: 'running', sent: 0, failed: 0, total: 0, filtered: 0, errors: [] };
  executeSend(jobId, { templateId, segmentId, subject, fromName, scheduleId, dryRun });
  res.json({ jobId });
});

// 발송 진행 상황 조회
app.get('/api/send-job/:jobId', (req, res) => {
  const job = sendJobs[req.params.jobId];
  if(!job) return res.status(404).json({ error: 'job not found' });
  res.json(job);
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
      if(!s.template_id || !s.segment_id) continue;
      const subject = s.subject || `[트립비토즈] ${s.template_name || '이메일'}`;
      const jobId = `sched_${s.id}`;
      sendJobs[jobId] = { status: 'running', sent: 0, failed: 0, total: 0, filtered: 0, errors: [] };
      console.log(`[scheduler] 발송 시작: ${s.template_name} → ${s.segment_name}`);
      executeSend(jobId, {
        templateId: s.template_id,
        segmentId: s.segment_id,
        subject,
        scheduleId: s.id,
      });
    }
  } catch(e) {
    console.error('[scheduler]', e.message);
  }
}

setInterval(runDueSchedules, 60 * 1000);

app.listen(3001, () => console.log('API server running on http://localhost:3001'));

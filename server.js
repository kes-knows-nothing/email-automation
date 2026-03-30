const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

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

app.listen(3001, () => console.log('API server running on http://localhost:3001'));

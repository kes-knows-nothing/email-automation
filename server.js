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
};

app.post('/api/query', async (req, res) => {
  const { sql } = req.body;
  if(!sql || !sql.trim()) return res.status(400).json({ error: 'SQL이 없습니다' });

  let conn;
  try {
    conn = await mysql.createConnection(DB);
    const start = Date.now();
    const [rows, fields] = await conn.execute(sql);
    const elapsed = Date.now() - start;

    if(!fields) {
      return res.json({ type: 'ok', affectedRows: rows.affectedRows, elapsed });
    }

    res.json({
      type: 'select',
      columns: fields.map(f => f.name),
      rows: rows.map(r => fields.map(f => r[f.name])),
      total: rows.length,
      elapsed,
    });
  } catch(err) {
    res.status(400).json({ error: err.message });
  } finally {
    if(conn) conn.end();
  }
});

app.listen(3001, () => console.log('API server running on http://localhost:3001'));

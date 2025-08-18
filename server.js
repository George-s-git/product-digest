
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

app.use(express.json());
app.use(cookieParser(process.env.COOKIE_SECRET || 'dev-fallback'));
app.use((req,res,next)=>{ res.setHeader('Cache-Control','no-store'); next(); });
app.use(express.static(path.join(__dirname,'public')));

async function query(sql, params=[]){
  const client = await pool.connect();
  try{ const r = await client.query(sql, params); return r; }
  finally{ client.release(); }
}

// init tables and seed products
async function init(){
  await query(`
    CREATE TABLE IF NOT EXISTS users(
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      surname TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      pass_hash TEXT NOT NULL,
      code CHAR(5) NOT NULL UNIQUE,
      payments_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS products(
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      image TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS carts(
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, product_id)
    );
  `);
  const r = await query('SELECT COUNT(*)::int AS c FROM products');
  if(r.rows[0].c === 0){
    await query(`
      INSERT INTO products (id,name,description,price_cents,image) VALUES
      (1,'Starter Bundle','Essential tools to get going fast.',2900,'/img/p1.png') ON CONFLICT (id) DO NOTHING;
    `);
    await query(`
      INSERT INTO products (id,name,description,price_cents,image) VALUES
      (2,'Pro Toolkit','Everything you need to scale.',4900,'/img/p2.png') ON CONFLICT (id) DO NOTHING;
    `);
    await query(`
      INSERT INTO products (id,name,description,price_cents,image) VALUES
      (3,'Ultimate VIP','Done-with-you premium package.',9900,'/img/p3.png') ON CONFLICT (id) DO NOTHING;
    `);
  }
}
function getUserId(req){ return req.signedCookies.uid ? parseInt(req.signedCookies.uid,10) : null; }
function requireAuth(req,res,next){ const id = getUserId(req); if(!id) return res.status(401).send('Not authenticated'); req.userId=id; next(); }
function randomCode5(){ return String(Math.floor(Math.random()*100000)).padStart(5,'0'); }

app.get('/api/session', async (req,res)=>{
  const uid = getUserId(req);
  if(!uid) return res.json({authenticated:false, cartCount:0});
  const u = await query('SELECT id,name,email FROM users WHERE id=$1',[uid]);
  const c = await query('SELECT COALESCE(SUM(quantity),0)::int AS n FROM carts WHERE user_id=$1',[uid]);
  res.json({authenticated:true, user:u.rows[0], cartCount:c.rows[0].n||0});
});

app.post('/api/register', async (req,res)=>{
  try{
    const {name,surname,email,pass} = req.body || {};
    if(!name||!surname||!email||!pass) return res.status(400).send('Missing fields');
    const ex = await query('SELECT 1 FROM users WHERE email=$1',[email]);
    if(ex.rowCount) return res.status(400).send('E-mail already registered');
    // unique 5-digit customer code
    let code; for(let i=0;i<20;i++){ code = randomCode5(); const c = await query('SELECT 1 FROM users WHERE code=$1',[code]); if(!c.rowCount) break; }
    const pass_hash = await bcrypt.hash(pass,10);
    const ins = await query('INSERT INTO users(name,surname,email,pass_hash,code) VALUES($1,$2,$3,$4,$5) RETURNING id',[name,surname,email,pass_hash,code]);
    res.cookie('uid', ins.rows[0].id, {
      httpOnly:true, signed:true, sameSite:'lax', secure: process.env.NODE_ENV === 'production'
    });
    res.json({ok:true});
  }catch(e){ console.error(e); res.status(500).send('Server error'); }
});

app.post('/api/login', async (req,res)=>{
  const {email,pass} = req.body || {};
  const u = await query('SELECT * FROM users WHERE email=$1',[email]);
  if(u.rowCount===0) return res.status(401).send('Invalid credentials');
  const ok = await bcrypt.compare(pass, u.rows[0].pass_hash);
  if(!ok) return res.status(401).send('Invalid credentials');
  res.cookie('uid', u.rows[0].id, {
    httpOnly:true, signed:true, sameSite:'lax', secure: process.env.NODE_ENV === 'production'
  });
  res.json({ok:true});
});

app.post('/api/logout',(req,res)=>{ res.clearCookie('uid'); res.json({ok:true}); });

app.get('/api/products', async (req,res)=>{
  const rows = await query('SELECT * FROM products ORDER BY id');
  res.json(rows.rows);
});
app.get('/api/products/:id', async (req,res)=>{
  const r = await query('SELECT * FROM products WHERE id=$1',[+req.params.id]);
  if(r.rowCount===0) return res.status(404).send('Not found');
  res.json(r.rows[0]);
});

app.get('/api/cart', requireAuth, async (req,res)=>{
  const r = await query(`SELECT c.product_id, c.quantity, p.name, p.price_cents
                         FROM carts c JOIN products p ON p.id=c.product_id
                         WHERE c.user_id=$1 ORDER BY c.product_id`, [req.userId]);
  res.json({items:r.rows});
});
app.post('/api/cart/add', requireAuth, async (req,res)=>{
  const {product_id} = req.body || {};
  if(!product_id) return res.status(400).send('product_id required');
  const have = await query('SELECT 1 FROM products WHERE id=$1',[product_id]);
  if(!have.rowCount) return res.status(404).send('Product not found');
  await query(`INSERT INTO carts(user_id,product_id,quantity) VALUES($1,$2,1)
               ON CONFLICT (user_id,product_id) DO UPDATE SET quantity = carts.quantity + 1`, [req.userId, product_id]);
  res.json({ok:true});
});
app.post('/api/cart/remove', requireAuth, async (req,res)=>{
  const {product_id} = req.body || {};
  if(!product_id) return res.status(400).send('product_id required');
  await query('DELETE FROM carts WHERE user_id=$1 AND product_id=$2',[req.userId, product_id]);
  res.json({ok:true});
});

app.post('/api/pay', requireAuth, async (req,res)=>{
  const cnt = await query('SELECT COUNT(*)::int AS c FROM carts WHERE user_id=$1',[req.userId]);
  if(cnt.rows[0].c === 0){
    return res.status(400).json({ok:false, error:'Cart is empty'});
  }
  await query('UPDATE users SET payments_count = payments_count + 1 WHERE id=$1',[req.userId]);
  await query('DELETE FROM carts WHERE user_id=$1',[req.userId]);
  res.json({ok:true});
});

app.get('/api/profile', requireAuth, async (req,res)=>{
  const u = await query('SELECT name,surname,email,code,payments_count FROM users WHERE id=$1',[req.userId]);
  res.json(u.rows[0]);
});

app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

init().then(()=>{
  app.listen(PORT, ()=> console.log('Server running at http://localhost:'+PORT));
}).catch(err=>{
  console.error('DB init failed', err);
  process.exit(1);
});

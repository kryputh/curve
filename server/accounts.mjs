import { randomBytes, randomUUID, scrypt as derive, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(derive);
const hash = value => createHash('sha256').update(value).digest('hex');
const lifetime = 8 * 60 * 60 * 1000;
const usernamePattern = /^[a-z0-9][a-z0-9_.-]{2,47}$/;
const passwordValid = value => typeof value === 'string' && value.length >= 12 && value.length <= 128;
const dummySalt = '00000000000000000000000000000000';

async function passwordHash(password, salt) {
  return scrypt(password, salt, 64);
}

export async function createAccount(db, username, password, role = 'tenant') {
  if (!usernamePattern.test(username) || !passwordValid(password)) throw new Error('Invalid account credentials.');
  const salt = randomBytes(16).toString('hex');
  const secret = (await passwordHash(password, salt)).toString('hex');
  return db.query(
    'INSERT INTO accounts(id,username,role,salt,password_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(username) DO NOTHING RETURNING id',
    [randomUUID(), username, role, salt, secret],
  );
}

export async function initializeAccounts(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, role TEXT NOT NULL CHECK (role IN ('tenant','operator')),
      salt TEXT NOT NULL, password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  `);
}

export function mountAccounts(app, db, secureCookies) {
  const cookieOptions = {httpOnly:true, sameSite:'strict', secure:secureCookies, path:'/'};
  const attempts = new Map();
  const tokenFrom = req => req.headers.cookie?.match(/(?:^|;\s*)curve_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  function throttle(req, res, next) {
    const now = Date.now();
    for (const [ip, bucket] of attempts) if (bucket.until <= now) attempts.delete(ip);
    const ip = req.ip;
    const bucket = attempts.get(ip) ?? {count:0, until:now + 60_000};
    attempts.set(ip, bucket);
    if (++bucket.count > 10) return res.status(429).json({error:'Too many attempts. Try again in a minute.'});
    next();
  }
  const userOf = row => ({id:row.id,role:row.role,name:row.username});
  app.use(async (req, res, next) => {
    const token = tokenFrom(req);
    if (token) {
      const {rows:[row]} = await db.query(`
        SELECT accounts.id, accounts.username, accounts.role FROM sessions
        JOIN accounts ON accounts.id=sessions.account_id
        WHERE token_hash=$1 AND expires_at>now()
      `, [hash(token)]);
      if (row) req.user = userOf(row);
    }
    next();
  });
  async function signIn(req, res, row) {
    const token = randomBytes(32).toString('hex');
    const oldToken = tokenFrom(req);
    await db.transaction(async tx => {
      await tx.query('DELETE FROM sessions WHERE expires_at<=now() OR token_hash=$1', [oldToken ? hash(oldToken) : '']);
      await tx.query('INSERT INTO sessions(token_hash,account_id,expires_at) VALUES($1,$2,$3)',
        [hash(token), row.id, new Date(Date.now() + lifetime).toISOString()]);
    });
    res.cookie('curve_session', token, {...cookieOptions,maxAge:lifetime}).json({user:userOf(row),mode:'service'});
  }
  app.post('/api/auth/register', throttle, async (req, res) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const password = req.body?.password;
    if (!usernamePattern.test(username) || !passwordValid(password)) {
      return res.status(400).json({error:'Use a 3–48 character username and a 12–128 character password.'});
    }
    const {rows:[row]} = await createAccount(db, username, password);
    if (!row) return res.status(409).json({error:'Username is unavailable.'});
    return signIn(req, res, {id:row.id,username,role:'tenant'});
  });
  app.post('/api/auth/login', throttle, async (req, res) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const password = req.body?.password;
    if (!usernamePattern.test(username) || !passwordValid(password)) return res.status(401).json({error:'Invalid credentials.'});
    const {rows:[row]} = await db.query('SELECT * FROM accounts WHERE username=$1', [username]);
    const candidate = await passwordHash(password, row?.salt ?? dummySalt);
    if (!timingSafeEqual(candidate, Buffer.from(row?.password_hash ?? '00'.repeat(64), 'hex')) || !row) {
      return res.status(401).json({error:'Invalid credentials.'});
    }
    return signIn(req, res, row);
  });
  app.post('/api/auth/logout', async (req, res) => {
    const token = tokenFrom(req);
    if (token) await db.query('DELETE FROM sessions WHERE token_hash=$1', [hash(token)]);
    res.clearCookie('curve_session', cookieOptions).json({ok:true});
  });
}

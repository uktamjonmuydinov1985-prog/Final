const fs = require('fs');
const path = require('path');
const https = require('https');

// Token is embedded temporarily as requested.
// IMPORTANT: rotate this token in @BotFather after deployment because it has been exposed.
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8812359863:AAG6-Ww1pbCNuzHO4GkNAXTCE3fG7Dg4swY';

const ADMIN_ID = 8279536115;
const DEFAULT_CHANNEL = '@kino_tarjimaa_uzz';
const DB_FILE = path.join(process.cwd(), 'kino_db.json');

let db = { movies: {}, channels: [DEFAULT_CHANNEL] };

try {
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  }
} catch (e) {
  console.error('DB read error:', e.message);
}

if (!db || typeof db !== 'object') db = { movies: {}, channels: [DEFAULT_CHANNEL] };
if (!db.movies || typeof db.movies !== 'object') db.movies = {};
if (!Array.isArray(db.channels) || db.channels.length === 0) db.channels = [DEFAULT_CHANNEL];
if (!db.channels.includes(DEFAULT_CHANNEL)) db.channels.unshift(DEFAULT_CHANNEL);

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('DB write error:', e.message);
  }
}

function api(method, params = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(params);

    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TOKEN}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.ok) resolve(json.result);
          else reject(new Error(json.description || 'Telegram API error'));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const pending = new Map();
let offset = 0;

async function send(chatId, text) {
  return api('sendMessage', { chat_id: chatId, text });
}

async function sendVideo(chatId, fileId, caption) {
  return api('sendVideo', {
    chat_id: chatId,
    video: fileId,
    caption: caption || undefined
  });
}

function isAdmin(id) {
  return Number(id) === ADMIN_ID;
}

async function subscribed(userId) {
  for (const channel of db.channels) {
    try {
      const member = await api('getChatMember', {
        chat_id: channel,
        user_id: userId
      });

      if (['left', 'kicked'].includes(member.status)) return false;
    } catch (e) {
      console.error('Channel check error:', channel, e.message);
      return false;
    }
  }
  return true;
}

async function handle(msg) {
  if (!msg || !msg.chat || !msg.from) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = (msg.text || '').trim();

  // Admin sends the video after /save CODE | Movie name
  if (isAdmin(userId) && pending.has(userId) && msg.video) {
    const p = pending.get(userId);

    db.movies[p.code] = {
      name: p.name,
      file_id: msg.video.file_id
    };

    saveDb();
    pending.delete(userId);

    return send(
      chatId,
      `✅ Saqlandi!\n\n🎬 ${p.name}\n🔑 Kod: ${p.code}`
    );
  }

  if (isAdmin(userId) && text.startsWith('/save')) {
    const arg = text.slice('/save'.length).trim();
    const parts = arg.split('|');

    if (parts.length < 2 || !parts[0].trim() || !parts[1].trim()) {
      return send(chatId, 'Format:\n/save KOD | Kino nomi\n\nKeyin videoni yuboring.');
    }

    const code = parts[0].trim().toUpperCase();
    const name = parts.slice(1).join('|').trim();

    pending.set(userId, { code, name });

    return send(
      chatId,
      `🎬 ${name}\n🔑 Kod: ${code}\n\nEndi videoni yuboring.`
    );
  }

  if (isAdmin(userId) && text.startsWith('/addchannel')) {
    const channel = text.slice('/addchannel'.length).trim();

    if (!channel) {
      return send(chatId, 'Format:\n/addchannel @kanal');
    }

    if (!channel.startsWith('@')) {
      return send(chatId, 'Kanal @username ko‘rinishida bo‘lsin.');
    }

    if (!db.channels.includes(channel)) {
      db.channels.push(channel);
      saveDb();
      return send(chatId, `✅ Qo‘shildi: ${channel}`);
    }

    return send(chatId, 'Bu kanal allaqachon mavjud.');
  }

  if (isAdmin(userId) && text.startsWith('/delchannel')) {
    const channel = text.slice('/delchannel'.length).trim();

    if (!channel) {
      return send(chatId, 'Format:\n/delchannel @kanal');
    }

    if (channel === DEFAULT_CHANNEL) {
      return send(chatId, '❌ Asosiy kanalni o‘chirib bo‘lmaydi.');
    }

    if (!db.channels.includes(channel)) {
      return send(chatId, 'Bu kanal ro‘yxatda yo‘q.');
    }

    db.channels = db.channels.filter(x => x !== channel);
    saveDb();

    return send(chatId, `🗑 O‘chirildi: ${channel}`);
  }

  if (isAdmin(userId) && text === '/channels') {
    return send(
      chatId,
      '📢 Majburiy kanallar:\n' +
      db.channels.map((x, i) => `${i + 1}. ${x}`).join('\n')
    );
  }

  if (isAdmin(userId) && text === '/list') {
    const items = Object.entries(db.movies);

    if (!items.length) {
      return send(chatId, 'Hali kino saqlanmagan.');
    }

    return send(
      chatId,
      '🎬 Kinolar:\n' +
      items.map(([code, movie]) => `${code} — ${movie.name}`).join('\n')
    );
  }

  if (isAdmin(userId) && text.startsWith('/delete')) {
    const code = text.slice('/delete'.length).trim().toUpperCase();

    if (!code) {
      return send(chatId, 'Format:\n/delete KOD');
    }

    if (!db.movies[code]) {
      return send(chatId, 'Bu kod topilmadi.');
    }

    delete db.movies[code];
    saveDb();

    return send(chatId, `🗑 O‘chirildi: ${code}`);
  }

  if (text === '/start') {
    return send(
      chatId,
      '🎬 Kino botga xush kelibsiz!\n\n' +
      'Kino kodini yuboring.'
    );
  }

  if (!text || text.startsWith('/')) return;

  if (!(await subscribed(userId))) {
    return send(
      chatId,
      '❗ Kino olish uchun majburiy kanallarga obuna bo‘ling.\n\n' +
      db.channels.join('\n')
    );
  }

  const code = text.toUpperCase();
  const movie = db.movies[code];

  if (!movie) {
    return send(chatId, '❌ Bu kod bo‘yicha kino topilmadi.');
  }

  return sendVideo(chatId, movie.file_id, `🎬 ${movie.name}`);
}

async function poll() {
  console.log('Kino bot started.');

  while (true) {
    try {
      const updates = await api('getUpdates', {
        offset,
        timeout: 50,
        allowed_updates: ['message']
      });

      for (const update of updates) {
        offset = update.update_id + 1;

        try {
          await handle(update.message);
        } catch (e) {
          console.error('Update error:', e.message);
        }
      }
    } catch (e) {
      console.error('Polling error:', e.message);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

process.on('SIGTERM', () => {
  console.log('Stopping bot...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Stopping bot...');
  process.exit(0);
});

poll();

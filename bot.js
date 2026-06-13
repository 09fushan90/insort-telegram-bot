require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const admin = require('firebase-admin');
const http = require('http');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL;
const FIREBASE_SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT;
const FIREBASE_SERVICE_ACCOUNT_BASE64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './serviceAccountKey.json';

if (!BOT_TOKEN) throw new Error('BOT_TOKEN is missing in .env');
if (!ADMIN_CHAT_ID) throw new Error('ADMIN_CHAT_ID is missing in .env');
if (!FIREBASE_DATABASE_URL) throw new Error('FIREBASE_DATABASE_URL is missing in .env');

function getServiceAccount() {
  if (FIREBASE_SERVICE_ACCOUNT) {
    return JSON.parse(FIREBASE_SERVICE_ACCOUNT);
  }

  if (FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const jsonText = Buffer.from(FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
    return JSON.parse(jsonText);
  }

  try {
    return require(SERVICE_ACCOUNT_PATH);
  } catch (error) {
    throw new Error('Firebase service account is missing. Add FIREBASE_SERVICE_ACCOUNT in Render Environment. Do not upload serviceAccountKey.json to GitHub.');
  }
}

admin.initializeApp({
  credential: admin.credential.cert(getServiceAccount()),
  databaseURL: FIREBASE_DATABASE_URL,
});

const db = admin.database();
const bot = new Telegraf(BOT_TOKEN);

const userSessions = new Map();

function makeReceiptNumber() {
  return String(Math.floor(100000000 + Math.random() * 900000000));
}

function makeShortId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 5; i++) result += alphabet[Math.floor(Math.random() * alphabet.length)];
  return result;
}

function money(value) {
  const num = Number(value || 0);
  return `${num.toLocaleString('uk-UA')} грн`;
}

function normalizeCart(raw) {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  return items.map((item, index) => ({
    name: item.name || item.title || `Товар ${index + 1}`,
    qty: Number(item.qty || item.quantity || 1),
    price: Number(item.price || 0),
  }));
}

function cartTotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function cartText(items) {
  return items.map((item, index) => {
    const lineTotal = item.price * item.qty;
    return `${index + 1}. ${item.name} ×${item.qty} — ${money(lineTotal)}`;
  }).join('\n');
}

function getDeliveryName(value) {
  return {
    nova_poshta: 'Нова Пошта',
    ukrposhta: 'Укрпошта',
    pickup: 'Самовивіз: с. Красилівка, Лісовий',
  }[value] || value;
}

function getPaymentName(value) {
  return {
    card: 'Оплата одразу на картку',
    cod: 'Накладний платіж',
    cash: 'Готівкою при отриманні',
  }[value] || value;
}

function buildClientSummary(order) {
  const email = order.email ? order.email : 'не вказано';
  return `📋 Перевірте ваше замовлення\n\n` +
    `🧾 Чек: ${order.receiptNumber}\n` +
    `🆔 ID: ${order.shortId}\n\n` +
    `👤 ${order.fullName}\n` +
    `📞 ${order.phone}\n` +
    `📧 ${email}\n` +
    `🏙 ${order.city}\n\n` +
    `🚚 ${getDeliveryName(order.delivery)}\n` +
    `💳 ${getPaymentName(order.payment)}\n\n` +
    `📦 Товари:\n${cartText(order.items)}\n\n` +
    `💰 Разом: ${money(order.total)}`;
}

function buildAdminSummary(order) {
  return `🛒 НОВЕ ЗАМОВЛЕННЯ\n\n` + buildClientSummary(order);
}

async function loadTempOrder(orderId) {
  const snap = await db.ref(`orders_temp/${orderId}`).get();
  if (!snap.exists()) return null;
  return snap.val();
}

async function saveFinalOrder(order) {
  await db.ref(`orders/${order.receiptNumber}`).set(order);
}

bot.start(async (ctx) => {
  const startPayload = (ctx.startPayload || '').trim();

  if (!startPayload) {
    return ctx.reply('Вітаю! Щоб оформити замовлення, перейдіть у бота через кнопку “Замовити” на сайті InSort.');
  }

  try {
    const tempOrder = await loadTempOrder(startPayload);
    if (!tempOrder) {
      return ctx.reply('Не вдалося знайти ваше замовлення. Поверніться на сайт і натисніть “Замовити” ще раз.');
    }

    const items = normalizeCart(tempOrder);
    if (!items.length) {
      return ctx.reply('Кошик порожній. Поверніться на сайт і додайте товар у кошик.');
    }

    userSessions.set(ctx.from.id, {
      step: 'confirm_cart',
      tempOrderId: startPayload,
      telegramUserId: ctx.from.id,
      telegramUsername: ctx.from.username || null,
      items,
      total: cartTotal(items),
    });

    await ctx.reply(
      `🛒 Ваше замовлення\n\n📦 Товари:\n${cartText(items)}\n\n💰 Разом: ${money(cartTotal(items))}\n\nПідтвердити замовлення?`,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Підтвердити', 'confirm_cart')],
        [Markup.button.callback('❌ Скасувати', 'cancel_order')],
      ])
    );
  } catch (error) {
    console.error(error);
    await ctx.reply('Сталася помилка при відкритті замовлення. Спробуйте ще раз.');
  }
});

bot.action('confirm_cart', async (ctx) => {
  const session = userSessions.get(ctx.from.id);
  if (!session) return ctx.answerCbQuery('Сесія замовлення не знайдена');
  session.step = 'fullName';
  userSessions.set(ctx.from.id, session);
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  await ctx.reply('Введіть ваше ім’я та прізвище:');
});

bot.action('cancel_order', async (ctx) => {
  userSessions.delete(ctx.from.id);
  await ctx.answerCbQuery();
  await ctx.reply('❌ Замовлення скасовано.');
});

bot.on('text', async (ctx) => {
  const session = userSessions.get(ctx.from.id);
  if (!session) return;

  const text = ctx.message.text.trim();

  if (session.step === 'fullName') {
    session.fullName = text;
    session.step = 'phone';
    userSessions.set(ctx.from.id, session);
    return ctx.reply('Введіть номер телефону:');
  }

  if (session.step === 'phone') {
    session.phone = text;
    session.step = 'email';
    userSessions.set(ctx.from.id, session);
    return ctx.reply(
      'Введіть електронну пошту. Це необов’язково.',
      Markup.inlineKeyboard([[Markup.button.callback('⏭ Пропустити', 'skip_email')]])
    );
  }

  if (session.step === 'email') {
    session.email = text;
    session.step = 'city';
    userSessions.set(ctx.from.id, session);
    return ctx.reply('Введіть місто:');
  }

  if (session.step === 'city') {
    session.city = text;
    session.step = 'delivery';
    userSessions.set(ctx.from.id, session);
    return ctx.reply(
      '🚚 Оберіть спосіб доставки:',
      Markup.inlineKeyboard([
        [Markup.button.callback('1️⃣ Нова Пошта', 'delivery_nova_poshta')],
        [Markup.button.callback('2️⃣ Укрпошта', 'delivery_ukrposhta')],
        [Markup.button.callback('3️⃣ Самовивіз: с. Красилівка, Лісовий', 'delivery_pickup')],
      ])
    );
  }
});

bot.action('skip_email', async (ctx) => {
  const session = userSessions.get(ctx.from.id);
  if (!session) return ctx.answerCbQuery('Сесія не знайдена');
  session.email = '';
  session.step = 'city';
  userSessions.set(ctx.from.id, session);
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  await ctx.reply('Введіть місто:');
});

async function handleDelivery(ctx, delivery) {
  const session = userSessions.get(ctx.from.id);
  if (!session) return ctx.answerCbQuery('Сесія не знайдена');
  session.delivery = delivery;
  session.step = 'payment';
  userSessions.set(ctx.from.id, session);
  await ctx.answerCbQuery();

  if (delivery === 'pickup') {
    return ctx.reply(
      '💳 Оберіть спосіб оплати:',
      Markup.inlineKeyboard([
        [Markup.button.callback('1️⃣ Оплата одразу на картку', 'payment_card')],
        [Markup.button.callback('3️⃣ Готівкою при самовивозі', 'payment_cash')],
      ])
    );
  }

  return ctx.reply(
    '💳 Оберіть спосіб оплати:',
    Markup.inlineKeyboard([
      [Markup.button.callback('1️⃣ Оплата одразу на картку', 'payment_card')],
      [Markup.button.callback('2️⃣ Накладний платіж', 'payment_cod')],
    ])
  );
}

bot.action('delivery_nova_poshta', (ctx) => handleDelivery(ctx, 'nova_poshta'));
bot.action('delivery_ukrposhta', (ctx) => handleDelivery(ctx, 'ukrposhta'));
bot.action('delivery_pickup', (ctx) => handleDelivery(ctx, 'pickup'));

async function handlePayment(ctx, payment) {
  const session = userSessions.get(ctx.from.id);
  if (!session) return ctx.answerCbQuery('Сесія не знайдена');

  const order = {
    receiptNumber: makeReceiptNumber(),
    shortId: makeShortId(),
    status: 'created',
    createdAt: new Date().toISOString(),
    tempOrderId: session.tempOrderId,
    telegramUserId: session.telegramUserId,
    telegramUsername: session.telegramUsername,
    items: session.items,
    total: session.total,
    fullName: session.fullName,
    phone: session.phone,
    email: session.email || '',
    city: session.city,
    delivery: session.delivery,
    payment,
  };

  session.pendingOrder = order;
  session.step = 'final_confirm';
  userSessions.set(ctx.from.id, session);
  await ctx.answerCbQuery();
  await ctx.reply(
    buildClientSummary(order),
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Підтвердити замовлення', 'final_confirm')],
      [Markup.button.callback('✏️ Змінити дані', 'restart_order')],
      [Markup.button.callback('❌ Скасувати', 'cancel_order')],
    ])
  );
}

bot.action('payment_card', (ctx) => handlePayment(ctx, 'card'));
bot.action('payment_cod', (ctx) => handlePayment(ctx, 'cod'));
bot.action('payment_cash', (ctx) => handlePayment(ctx, 'cash'));

bot.action('restart_order', async (ctx) => {
  const session = userSessions.get(ctx.from.id);
  if (!session) return ctx.answerCbQuery('Сесія не знайдена');
  session.step = 'fullName';
  session.fullName = '';
  session.phone = '';
  session.email = '';
  session.city = '';
  session.delivery = '';
  session.payment = '';
  session.pendingOrder = null;
  userSessions.set(ctx.from.id, session);
  await ctx.answerCbQuery();
  await ctx.reply('Добре, введіть ваше ім’я та прізвище ще раз:');
});

bot.action('final_confirm', async (ctx) => {
  const session = userSessions.get(ctx.from.id);
  if (!session?.pendingOrder) return ctx.answerCbQuery('Замовлення не знайдено');
  const order = session.pendingOrder;

  await saveFinalOrder(order);
  userSessions.delete(ctx.from.id);
  await ctx.answerCbQuery();
  await ctx.reply(
    `✅ Ваше замовлення успішно оформлено!\n\n🧾 Номер чеку: ${order.receiptNumber}\n🆔 ID замовлення: ${order.shortId}\n\nНезабаром менеджер почне обробку замовлення.\nОчікуйте повідомлення або дзвінок.`
  );

  await bot.telegram.sendMessage(
    ADMIN_CHAT_ID,
    buildAdminSummary(order),
    Markup.inlineKeyboard([
      [Markup.button.callback('👀 Роздивлятися замовлення', `admin_review_${order.receiptNumber}`)],
    ])
  );
});

bot.action(/^admin_review_(\d{9})$/, async (ctx) => {
  const receiptNumber = ctx.match[1];
  const snap = await db.ref(`orders/${receiptNumber}`).get();
  if (!snap.exists()) return ctx.answerCbQuery('Замовлення не знайдено');
  const order = snap.val();
  order.status = 'reviewing';
  await db.ref(`orders/${receiptNumber}`).update({ status: 'reviewing', reviewedAt: new Date().toISOString() });

  await bot.telegram.sendMessage(
    order.telegramUserId,
    '👀 Ваше замовлення вже роздивляються та скоро відправлять. Чекайте на повідомлення або дзвінок.'
  );

  await ctx.answerCbQuery('Клієнту надіслано повідомлення');
  await ctx.editMessageReplyMarkup(
    Markup.inlineKeyboard([
      [Markup.button.callback('❌ Відмінити', `admin_cancel_${receiptNumber}`)],
      [Markup.button.callback('📦 Відправлено', `admin_sent_${receiptNumber}`)],
    ]).reply_markup
  );
});

bot.action(/^admin_cancel_(\d{9})$/, async (ctx) => {
  const receiptNumber = ctx.match[1];
  const snap = await db.ref(`orders/${receiptNumber}`).get();
  if (!snap.exists()) return ctx.answerCbQuery('Замовлення не знайдено');
  const order = snap.val();
  await db.ref(`orders/${receiptNumber}`).update({ status: 'cancelled', cancelledAt: new Date().toISOString() });
  await bot.telegram.sendMessage(order.telegramUserId, '❌ Ваше замовлення відмінили.');
  await ctx.answerCbQuery('Замовлення відмінено');
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
});

bot.action(/^admin_sent_(\d{9})$/, async (ctx) => {
  const receiptNumber = ctx.match[1];
  const snap = await db.ref(`orders/${receiptNumber}`).get();
  if (!snap.exists()) return ctx.answerCbQuery('Замовлення не знайдено');
  const order = snap.val();
  await db.ref(`orders/${receiptNumber}`).update({ status: 'sent', sentAt: new Date().toISOString() });
  await bot.telegram.sendMessage(order.telegramUserId, '📦 Ваше замовлення відправлено. Очікуйте доставку.');
  await ctx.answerCbQuery('Клієнту надіслано повідомлення');
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
});

bot.catch((err) => console.error('Bot error:', err));
bot.launch();
console.log('InSort order bot started');

// Render Web Service needs an open port even if the Telegram bot works by polling.
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('InSort Telegram bot is running');
}).listen(PORT, () => {
  console.log(`Health server listening on port ${PORT}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

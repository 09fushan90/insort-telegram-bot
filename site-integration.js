// Встав цей код у сайт там, де натискається кнопка "Замовити в Telegram".
// Він бере товари з кошика, зберігає їх у Firebase і відкриває Telegram-бота.

const INSORT_BOT_USERNAME = 'insort_order_bot'; // заміни на username свого бота без @

function makeOrderId() {
  return 'ord_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}

async function orderCartInTelegram(cartItems) {
  if (!cartItems || !cartItems.length) {
    alert('Кошик порожній');
    return;
  }

  const orderId = makeOrderId();

  await firebase.database().ref('orders_temp/' + orderId).set({
    createdAt: new Date().toISOString(),
    items: cartItems.map(item => ({
      name: item.name || item.title || 'Товар',
      qty: Number(item.qty || item.quantity || 1),
      price: Number(item.price || 0),
      productId: item.id || null,
    }))
  });

  window.location.href = `https://t.me/${INSORT_BOT_USERNAME}?start=${orderId}`;
}

// Приклад:
// orderCartInTelegram(cart);

# InSort Telegram Order Bot

Бот приймає кошик із сайту, показує клієнту товари, питає дані, доставку, оплату, створює чек і відправляє замовлення в адмін-чат.

## Що вміє

- Відкривається через посилання `https://t.me/BOT_USERNAME?start=ORDER_ID`.
- Бере товари з Firebase `orders_temp/ORDER_ID`.
- Питає ім'я, телефон, пошту, місто.
- Питає доставку: Нова Пошта, Укрпошта, Самовивіз.
- Питає оплату: карта, накладний платіж, готівка для самовивозу.
- Створює номер чеку з 9 цифр.
- Створює ID з 5 символів: букви + цифри.
- Відправляє замовлення в адмін-чат.
- Кнопки адміна: роздивлятися, відмінити, відправлено.
- Клієнт отримує повідомлення про зміну статусу.

## Як запустити

1. Створи бота в Telegram через `@BotFather`.
2. Візьми `BOT_TOKEN`.
3. Створи групу/чат для замовлень і додай туди бота.
4. Дізнайся `ADMIN_CHAT_ID`.
5. У Firebase створи Service Account key і поклади файл поруч з `bot.js` під назвою `serviceAccountKey.json`.
6. Скопіюй `.env.example` у `.env` і заповни дані.
7. Встанови залежності:

```bash
npm install
```

8. Запусти:

```bash
npm start
```

## Структура кошика у Firebase

Сайт має створити запис:

```js
orders_temp/ORDER_ID = {
  createdAt: '2026-06-13T12:00:00.000Z',
  items: [
    { name: 'Шуруповерт Procraft', qty: 1, price: 2500 },
    { name: 'Акумулятор', qty: 2, price: 900 }
  ]
}
```

Потім сайт відкриває:

```text
https://t.me/insort_order_bot?start=ORDER_ID
```

## Важливо

Не додавай `serviceAccountKey.json` у GitHub. Це секретний файл.


## ВАЖЛИВО: Firebase ключ безпечно

Не завантажуй `serviceAccountKey.json` на GitHub.
У Render додай змінну Environment:

- KEY: `FIREBASE_SERVICE_ACCOUNT`
- VALUE: весь текст із файлу `serviceAccountKey.json` повністю, від `{` до `}`

Також потрібні змінні:

- `BOT_TOKEN`
- `ADMIN_CHAT_ID`
- `FIREBASE_DATABASE_URL`

Ця версія бота вже вміє читати Firebase ключ із Render Environment, тому файл `serviceAccountKey.json` більше не потрібен у репозиторії.

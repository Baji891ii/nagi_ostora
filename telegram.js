const TELEGRAM_API = 'https://api.telegram.org';

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

export function createTelegramPairing({ token, allowedChatId }) {
  const botToken = String(token || '').trim();
  const allowedId = String(allowedChatId || '').trim();

  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN غير مضبوط');
  if (!allowedId) throw new Error('TELEGRAM_ADMIN_ID غير مضبوط');

  let offset = 0;
  let stopped = false;
  let pollingPromise = null;
  let pairRequest = null;
  let pairRequestResolve = null;
  let pairRequestReject = null;

  async function api(method, body = {}) {
    const response = await fetch(`${TELEGRAM_API}/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok || !data?.ok) {
      throw new Error(`Telegram API ${method} فشل: ${data?.description || response.statusText}`);
    }

    return data.result;
  }

  async function sendMessage(text) {
    return api('sendMessage', {
      chat_id: allowedId,
      text,
      disable_web_page_preview: true
    });
  }

  function clearPairRequest(error = null) {
    if (pairRequestReject && error) pairRequestReject(error);
    pairRequest = null;
    pairRequestResolve = null;
    pairRequestReject = null;
  }

  function requestPairingPhone() {
    if (pairRequest) return pairRequest;

    pairRequest = new Promise((resolve, reject) => {
      pairRequestResolve = resolve;
      pairRequestReject = reject;
    });

    void sendMessage(
      '🔗 واتساب غير مربوط.\nأرسل الآن:\n/pair 201xxxxxxxxx\n\nأرسل الرقم بدون + أو مسافات.'
    ).catch(() => {});

    return pairRequest;
  }

  async function handleUpdate(update) {
    const message = update?.message;
    if (!message?.chat) return;

    const chatId = String(message.chat.id || '');
    const senderId = String(message.from?.id || '');

    if (chatId !== allowedId || senderId !== allowedId || message.chat.type !== 'private') {
      return;
    }

    const text = String(message.text || '').trim();
    if (!text) return;

    if (/^\/(?:start|help)(?:@\w+)?$/i.test(text)) {
      await sendMessage(
        '✅ قناة الربط فقط.\n\nللحصول على كود ربط WhatsApp أرسل:\n/pair 201xxxxxxxxx'
      );
      return;
    }

    const match = text.match(/^\/pair(?:@\w+)?\s+(.+)$/i);
    if (match) {
      const phone = normalizePhone(match[1]);
      if (phone.length < 8) {
        await sendMessage('❌ رقم الهاتف غير صالح. أرسله بصيغة دولية بدون +، مثل: /pair 201xxxxxxxxx');
        return;
      }

      if (pairRequestResolve) {
        const resolve = pairRequestResolve;
        pairRequest = null;
        pairRequestResolve = null;
        pairRequestReject = null;
        resolve(phone);
        await sendMessage('⏳ تم استلام الرقم. جاري إنشاء كود الربط من WhatsApp...');
      } else {
        pairRequest = Promise.resolve(phone);
        await sendMessage('⏳ تم استلام الرقم. سيُستخدم لطلب كود الربط عند جاهزية WhatsApp.');
      }
      return;
    }

    await sendMessage('استخدم فقط: /pair 201xxxxxxxxx');
  }

  async function poll() {
    if (stopped) return;

    try {
      const updates = await api('getUpdates', {
        offset,
        timeout: 25,
        allowed_updates: ['message']
      });

      for (const update of updates || []) {
        offset = Math.max(offset, Number(update.update_id || 0) + 1);
        try {
          await handleUpdate(update);
        } catch (error) {
          console.error('[TELEGRAM]', error?.message || error);
        }
      }
    } catch (error) {
      console.error('[TELEGRAM]', error?.message || error);
      await new Promise(resolve => setTimeout(resolve, 2500));
    }

    if (!stopped) pollingPromise = poll();
    return pollingPromise;
  }

  async function start() {
    const me = await api('getMe');
    await api('deleteWebhook', { drop_pending_updates: false });
    console.log(`✅ Telegram control جاهز: @${me?.username || 'bot'}`);
    pollingPromise = poll();
  }

  function stop() {
    stopped = true;
    clearPairRequest(new Error('Telegram pairing controller stopped'));
  }

  async function getPairingPhone() {
    return requestPairingPhone();
  }

  async function sendPairingCode(code, phone) {
    const formatted = String(code || '').match(/.{1,4}/g)?.join('-') || String(code || '');
    await sendMessage(
      `🔐 كود ربط WhatsApp\n\n📱 الرقم: ${phone}\n🔑 الكود: ${formatted}\n\nاستخدم الكود داخل WhatsApp لإكمال الربط.`
    );
  }

  async function sendError(message) {
    await sendMessage(`❌ ${message}`);
  }

  return {
    start,
    stop,
    getPairingPhone,
    sendPairingCode,
    sendError
  };
}

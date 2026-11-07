import fs from 'fs/promises';
import config from './config.js';
import { init as dbInit, read } from './database/index.js';
import { loadCommands, get, list, dispatch } from './heart/index.js';
import { connect } from './whatsapp/connection.js';
import { normalize } from './whatsapp/message.js';
import { resolve, roleOf, register } from './security/index.js';
import { hasRole } from './security/roles.js';
import { setGroupMetadata } from './services/group-cache.js';
import { system, loaded, incoming, command, error, setEnabled } from './console/index.js';

const seenMessages = new Map();
const SEEN_TTL = 120_000;

// حد أقصى للرسائل التي تُعالج في نفس الوقت حتى لا يؤدي سيل الرسائل
// إلى استهلاك الاتصالات/الذاكرة، مع إبقاء الأوامر المستقلة سريعة.
const MAX_MESSAGE_CONCURRENCY = 8;
let activeMessages = 0;
const pendingMessages = [];

async function withMessageSlot(task) {
  if (activeMessages >= MAX_MESSAGE_CONCURRENCY) {
    await new Promise(resolve => pendingMessages.push(resolve));
  }

  activeMessages += 1;

  try {
    return await task();
  } finally {
    activeMessages -= 1;
    const next = pendingMessages.shift();
    if (next) next();
  }
}

function cleanCommandText(value) {
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trimStart();
}

function tokenize(value) {
  const tokens = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/gu;
  let match;
  while ((match = re.exec(value))) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

/*
 * توحيد اسم الأمر للمقارنة.
 *
 * المسافات والشرطات والـ underscore تعتبر فواصل
 * بين أجزاء اسم الأمر.
 *
 * مثال:
 *
 * رفع ادمن
 * رفع-ادمن
 * رفع_ادمن
 *
 * يمكن أن تشير إلى نفس اسم الأمر عند المطابقة،
 * مع بقاء الاسم الأصلي المسجل في الـ Registry
 * هو الاسم الذي سيتم تنفيذه.
 */
function normalizeCommandName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ');
}

/*
 * قراءة اسم الأمر من الرسالة.
 *
 * النظام يبحث عن أطول اسم أمر أولًا.
 *
 * مثال:
 *
 * لو Registry يحتوي:
 *
 * رفع
 * رفع ادمن
 *
 * والرسالة:
 *
 * .رفع ادمن
 *
 * سيتم اختيار:
 *
 * رفع ادمن
 *
 * وليس:
 *
 * رفع
 *
 * وبالتالي تصبح الأوامر متعددة الكلمات
 * أوامر حقيقية ومستقلة.
 */
function parseCommand(text) {
  const normalized =
    cleanCommandText(text);

  if (!normalized.startsWith(config.prefix)) {
    return null;
  }

  const body =
    normalized
      .slice(config.prefix.length)
      .trim();

  if (!body) {
    return null;
  }

  /*
   * جميع أسماء الأوامر المسجلة.
   *
   * نرتبها من الأطول إلى الأقصر حتى يتم
   * اختيار الأمر المركب قبل الأمر القصير.
   */
  const commandNames =
    list()
      .filter(Boolean)
      .sort(
        (a, b) =>
          String(b).length -
          String(a).length
      );

  const normalizedBody =
    normalizeCommandName(body);

  for (const commandName of commandNames) {
    const normalizedName =
      normalizeCommandName(commandName);

    if (!normalizedName) {
      continue;
    }

    /*
     * تطابق كامل:
     *
     * .رفع ادمن
     */
    if (
      normalizedBody ===
      normalizedName
    ) {
      return {
        name: commandName,
        args: []
      };
    }

    /*
     * تطابق اسم الأمر مع وجود arguments بعده:
     *
     * .رفع ادمن @123
     *
     * أو:
     *
     * .درر حديث صوم
     */
    if (
      normalizedBody.startsWith(
        normalizedName + ' '
      )
    ) {
      /*
       * نأخذ الجزء الأصلي من body بدل
       * الاعتماد على normalizedBody حتى لا
       * نغيّر محتوى arguments.
       */
      const commandPartLength =
        String(commandName).length;

      const originalCommandPart =
        body.slice(
          0,
          commandPartLength
        );

      if (
        normalizeCommandName(
          originalCommandPart
        ) !== normalizedName
      ) {
        continue;
      }

      const remaining =
        body
          .slice(commandPartLength)
          .trim();

      return {
        name: commandName,
        args:
          remaining
            ? tokenize(remaining)
            : []
      };
    }
  }

  /*
   * إذا لم نجد اسم أمر مسجلاً،
   * نعود للسلوك القديم حتى لا نكسر
   * الأوامر الموجودة حاليًا.
   */
  const tokens =
    tokenize(body);

  if (!tokens.length) {
    return null;
  }

  return {
    name: tokens[0],
    args: tokens.slice(1)
  };
}

function cleanupSeen() {
  const now = Date.now();

  for (
    const [id, time]
    of seenMessages
  ) {
    if (
      now - time >
      SEEN_TTL
    ) {
      seenMessages.delete(id);
    }
  }
}

setInterval(
  cleanupSeen,
  SEEN_TTL
).unref?.();

async function boot() {
  /*
   * إنشاء مجلد الأرشيف تلقائيًا عند تشغيل البوت.
   */
  await fs.mkdir('./data/archives', { recursive: true });

  await dbInit();

  const settings =
    await read(
      'settings.json',
      {
        console: true,
        mode: 'public',
        bot: 'user'
      }
    );

  setEnabled(
    settings.console !== false
  );

  const names =
    await loadCommands();

  loaded(names);

  system({
    loaded: names.length,
    status: 'ready',
    mode:
      settings.mode === 'private'
        ? 'الوضع الخاص'
        : 'الوضع العام',
    bot:
      settings.bot === 'developer'
        ? 'البوت مطور'
        : 'البوت ليس مطور',
    permissions: 'working',
    connection: 'connecting'
  });

  await connect(onSocket);
}

async function processIncomingMessage(raw, sock) {
  try {
    // STEAM يعمل داخل المجموعات فقط.
    if (!String(raw.key?.remoteJid || '').endsWith('@g.us')) return;

    if (raw.key?.id) {
      if (seenMessages.has(`${raw.key.remoteJid || ''}:${raw.key.id}`)) return;
      seenMessages.set(`${raw.key.remoteJid || ''}:${raw.key.id}`, Date.now());
    }

    // ربط PN/LID فور توفرهما.
    if (raw.key?.participant && raw.key?.participantAlt) {
      register(raw.key.participant, raw.key.participantAlt);
    }

    if (raw.key?.remoteJid && raw.key?.remoteJidAlt) {
      register(raw.key.remoteJidAlt, raw.key.remoteJid);
    }

    const m = normalize(raw, sock);

    incoming({
      sender: m.sender,
      group: m.chatId,
      type: m.type,
      content: m.text
    });

    const cleanText = cleanCommandText(m.text);
    const parsed = parseCommand(cleanText);
    if (!parsed) return;

    let { name, args } = parsed;

    // صيغ الأرشيف القديمة/الحالية.
    if (name.startsWith('ارشيف-')) {
      args = [name.slice('ارشيف-'.length), ...args];
      name = 'ارشيف';
    } else if (name.startsWith('اضف-')) {
      args = [name.slice('اضف-'.length), ...args];
      name = 'اضف';
    }

    const cmd = get(name);
    if (!cmd) return;

    const role = await roleOf(m.sender);

    /*
     * وضع المطورين:
     * عند تفعيله لا يستجيب STEAM لأي شخص غير المطور.
     * لا يرسل تحذيرًا ولا reaction حتى يبقى البوت صامتًا تمامًا.
     */
    const runtimeSettings = await read(
      'settings.json',
      {
        console: true,
        mode: 'public',
        bot: 'user'
      }
    );

    if (
      runtimeSettings.mode === 'private' &&
      role !== 'developer'
    ) {
      return;
    }

    const requiredRole = cmd.requiredRole || 'user';

    if (!hasRole(role, requiredRole)) {
      const message =
        requiredRole === 'developer'
          ? '❌ معندكش صلاحية للأمر ده.\n👑 الأمر ده للمطور فقط.'
          : requiredRole === 'elite'
            ? '❌ معندكش صلاحية للأمر ده.\n⭐ الأمر ده للنخبة والمطورين.'
            : '❌ معندكش صلاحية لتنفيذ الأمر ده.';

      await m.reply(message);
      return;
    }

    command({
      role,
      number: String(resolve(m.sender) || '').split('@')[0],
      group: 'group',
      command: name
    });

    // dispatch لا يحجز الرسائل العادية؛ فقط الأمر الذي يعلن serial=true
    // يحصل على تسلسل داخل نفس المجموعة.
    await dispatch(
      {
        message: m,
        sock,
        args,
        text: args.join(' '),
        role
      },
      cmd
    );
  } catch (e) {
    error('MESSAGE', e);

    try {
      if (raw?.key?.remoteJid && !raw.key.fromMe) {
        await sock.sendMessage(
          raw.key.remoteJid,
          { text: `❌ تعذر تنفيذ الأمر.\nالسبب: ${e?.message || e}` },
          { quoted: raw }
        );
      }
    } catch {}
  }
}

function onSocket(sock) {
  sock.ev.on(
    'groups.upsert',
    groups => {
      for (const group of groups || []) {
        setGroupMetadata(group);
      }
    }
  );

  sock.ev.on(
    'groups.update',
    updates => {
      // connection.js handles partial updates in the shared cache.
      void updates;
    }
  );

  sock.ev.on(
    'contacts.update',
    updates => {
      for (
        const item
        of updates || []
      ) {
        if (
          item.id &&
          item.lid
        ) {
          register(
            item.id,
            item.lid
          );
        }
      }
    }
  );

  sock.ev.on(
    'messages.upsert',
    async up => {
      if (up.type !== 'notify') return;

      const messages = (up.messages || [])
        .filter(raw => raw?.message);

      // نفذ رسائل الدفعة بالتوازي بدل انتظار كل رسالة قبل التالية.
      // هذا هو الإصلاح الأساسي لتأخير الأوامر عند وصول عدة رسائل معًا.
      await Promise.allSettled(
        messages.map(raw =>
          withMessageSlot(() => processIncomingMessage(raw, sock))
        )
      );
    }
  );

}

boot().catch(e => {
  error(
    'BOOT',
    e
  );

  process.exitCode = 1;
});

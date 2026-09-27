/**
 * Scripts de exportación de chats para pegarlos en la consola del navegador
 * del sitio de origen (con la sesión del usuario ya iniciada).
 *
 * La extensión NO los ejecuta: solo los copia al portapapeles. Al ejecutarse
 * en la página del sitio, el script hereda la sesión abierta por el usuario
 * (cookie de sesión) y descarga los chats como .jsonl, el formato nativo de
 * SillyTavern. Ninguna credencial se almacena en la extensión.
 *
 * Endpointsyte verificados en /mnt/src_file/desarrollo_git/extraccion:
 *  - evidencia/tipsy_api_bodies.txt   (REST, sin cifrado)
 *  - evidencia/juicychat_traffic.mitm (REST + AES-128-CBC + doble Base64)
 */

/** Utilidades comunes que se anteponen a cada script para que sean autónomos. */
const COMMON = `
const _log = (...a) => console.log('%c[export]', 'color:#4a9eff;font-weight:bold', ...a);
const _err = (m) => console.error('%c[export] ERROR:', 'color:#ef5f5f;font-weight:bold', m);

function readCookie(name) {
  return document.cookie.split('; ')
    .find(c => c.startsWith(name + '='))
    ?.split('=').slice(1).join('=');
}

function download(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/jsonl' }));
  a.download = filename.replace(/[/?%*:|"<>]/g, '_');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Convierte los mensajes de un roleplay site al JSONL que SillyTavern importa.
// Una línea por mensaje: { name, is_user, is_name, send_date, mes, extra }
function toSillyTavernJsonl(messages, charName) {
  return messages
    .filter(m => m && (m.role || m.sender || m.author))
    .map(m => {
      const role = String(m.role ?? m.sender ?? m.author ?? '');
      const isUser = ['user', 'human'].includes(role.toLowerCase()) || role === '0';
      const text = m.content ?? m.text ?? m.message ?? '';
      const ts = m.createTime ?? m.create_time ?? m.timestamp ?? m.time;
      const ms = Number(ts);
      return JSON.stringify({
        name: isUser ? 'user' : charName,
        is_user: isUser,
        is_name: true,
        send_date: ts
          ? new Date(ms && ms < 1e12 ? ms * 1000 : ms).toISOString()
          : new Date().toISOString(),
        mes: String(text),
        extra: { swipes: [] },
      });
    })
    .join('\\n');
}
`;

/* ------------------------------------------------------------------ */
/*  Tipsy.chat — REST plano, token en cookie no-HttpOnly               */
/* ------------------------------------------------------------------ */
const TIPSY = `(async () => {
${COMMON}
  const HOST = 'https://api.tipsy.chat';
  const token = readCookie('token');
  if (!token) {
    _err('No se encontro la cookie "token".');
    _err('Asegurate de estar en tipsy.chat (sin www) y con la sesion iniciada.');
    console.log('Cookies visibles:', document.cookie);
    return;
  }
  _log('Token encontrado (' + token.length + ' chars)');

  const api = (path, body) => fetch(HOST + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(body),
  }).then(async (r) => {
    const j = await r.json();
    if (j.code && j.code !== 0) throw new Error(path + ' -> ' + (j.msg || j.code));
    return j.data;
  });

  const pick = (list) => {
    if (!list.length) return null;
    const labels = list.map((c, i) => (i + 1) + '. ' + (c.nickname || c.name || c.character_id));
    const choice = prompt('Que personaje quieres exportar?\\n\\n' + labels.join('\\n') + '\\n\\nEscribe el numero:', '1');
    return list[parseInt(choice, 10) - 1] || null;
  };

  _log('Obteniendo tus personajes...');
  const charsData = await api('/api/v1/character/list/self', {});
  const chars = charsData?.list || charsData?.characterList || (Array.isArray(charsData) ? charsData : []);
  _log('Personajes encontrados: ' + chars.length);
  if (!chars.length) { _err('La API no devolvio personajes. Puede que la sesion no sea valida.'); return; }

  const urlId = location.pathname.match(/\\/chat\\/(\\d+)/)?.[1];
  const char = (urlId && chars.find(c => String(c.character_id) === urlId)) || await pick(chars);
  if (!char) { _err('Cancelado.'); return; }

  const charName = char.nickname || char.name || 'personaje';
  _log('Personaje: ' + charName + ' (' + char.character_id + ')');

  _log('Obteniendo conversaciones...');
  const convData = await api('/api/v1/conversation/list', { character_id: char.character_id });
  const convos = convData?.list || convData?.conversations || (Array.isArray(convData) ? convData : []);
  _log('Conversaciones: ' + convos.length);
  if (!convos.length) { _err('No hay conversaciones para este personaje.'); return; }

  let n = 0;
  for (const convo of convos) {
    const label = convo.title || convo.name || convo.conversation_id || ('chat-' + (n + 1));
    try {
      const hist = await api('/api/v1/chat/history', {
        character_id: char.character_id,
        sequence: '0',
        size: 9999,
        language_code: 'es',
      });
      const msgs = hist?.messages || hist?.list || hist?.history || [];
      if (!msgs.length) { _log('· ' + label + ': vacio, saltando'); continue; }
      download(charName + ' - ' + label + '.jsonl', toSillyTavernJsonl(msgs, charName));
      n++;
      _log('· ' + label + ': ' + msgs.length + ' mensajes -> descargado');
    } catch (e) {
      _err(label + ': ' + e.message);
    }
    await new Promise(r => setTimeout(r, 400));
  }
  _log('Listo. ' + n + ' chat(s) en tu carpeta de Descargas.');
})();`;

/* ------------------------------------------------------------------ */
/*  JuicyChat — REST + AES-128-CBC + doble Base64                      */
/* ------------------------------------------------------------------ */
const JUICYCHAT = `(async () => {
${COMMON}
  const KEY = 'yume1aJ83ZbPpkwb';
  const IV  = 'yume2024cccydnzc';
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const keyP = crypto.subtle.importKey(
    'raw', enc.encode(KEY), { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']
  );

  async function encrypt(obj) {
    const inner = enc.encode(btoa(unescape(encodeURIComponent(JSON.stringify(obj)))));
    const ct = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: enc.encode(IV) }, await keyP, inner);
    return btoa(String.fromCharCode(...new Uint8Array(ct)));
  }

  async function decrypt(b64str) {
    const ct = Uint8Array.from(atob(b64str), (c) => c.charCodeAt(0));
    const inner = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: enc.encode(IV) }, await keyP, ct);
    return JSON.parse(decodeURIComponent(escape(atob(dec.decode(inner)))));
  }

  const token = readCookie('token') || readCookie('access_token') || readCookie('jwt');
  if (!token) {
    _err('No se encontro la cookie de sesion (token / access_token / jwt).');
    _err('Revisa DevTools > Application > Cookies y ajusta los nombres en el script.');
    return;
  }
  _log('Token encontrado (' + token.length + ' chars)');

  const BASE = 'https://www.juicychat.ai';
  const post = async (path, body) => {
    const r = await fetch(BASE + path, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'token': token,
        'secretkey': 'a76946fd72g1bc4d9797de189ec4af6808',
        'appversion': '0.1.38',
        'client': 'pc',
        'platformtype': 'web',
        'system': 'other',
        'language': 'es',
      },
      body: JSON.stringify({ requestData: await encrypt(body) }),
    });
    const j = await r.json();
    if (!j.responseData) throw new Error(path + ': respuesta sin responseData');
    const inner = await decrypt(j.responseData);
    if (String(inner.code) !== '200') throw new Error(path + ': ' + (inner.msg || inner.code));
    return inner.data;
  };

  const urlId = location.pathname.match(/\\/chat\\/(\\d+)/)?.[1];
  if (!urlId) { _err('Abre primero la pagina del personaje (/es/chat/<id>).'); return; }
  _log('Personaje: ' + urlId);

  const detail = await post('/yume/api/user/v1/character/getCharacterDetail', { characterId: urlId });
  const charName = detail?.characterName || 'personaje';
  _log('Nombre: ' + charName);

  const listData = await post('/yume/api/user/v1/chat/getUserChatList', { characterId: urlId, chatId: '0' });
  const chats = listData?.list || listData?.chatList || (Array.isArray(listData) ? listData : []);
  _log('Chats encontrados: ' + chats.length);
  if (!chats.length) {
    _err('No devolvio lista de chats. Estructura recibida:');
    console.log(JSON.stringify(listData).slice(0, 400));
    return;
  }

  // Endpoint de mensajes NO confirmado en el analisis forense. Si falla,
  // abre DevTools > Network, busca la peticion que carga los mensajes de un
  // chat abierto y ajusta esta constante.
  const MSG_PATH = '/yume/api/user/v1/chat/getChatMessage';

  let n = 0;
  for (const c of chats) {
    const chatId = c.chatId || c.id;
    const label = c.title || c.chatName || ('chat-' + chatId);
    try {
      const data = await post(MSG_PATH, { characterId: urlId, chatId: String(chatId) });
      const msgs = data?.messages || data?.list || (Array.isArray(data) ? data : []);
      if (!msgs.length) { _log('· ' + label + ': vacio'); continue; }
      download(charName + ' - ' + label + '.jsonl', toSillyTavernJsonl(msgs, charName));
      n++;
      _log('· ' + label + ': ' + msgs.length + ' mensajes');
    } catch (e) {
      _err(label + ': ' + e.message);
      _err('Si todos fallan el endpoint de mensajes es otro. Copialo desde Network');
      _err('y ajustalo en la constante MSG_PATH de este script.');
      break;
    }
    await new Promise(r => setTimeout(r, 400));
  }
  _log('Listo. ' + n + ' chat(s) descargados.');
})();`;

/* ------------------------------------------------------------------ */
/*  Moescape / Emochi — sin endpoint de chat confirmado                */
/* ------------------------------------------------------------------ */
const MOESCAPE = `(async () => {
${COMMON}
  _err('Moescape: no hay endpoint de historial confirmado en el analisis.');
  _err('');
  _err('La extension SI importa personajes de Moescape (GET /v1/characters/{uuid}),');
  _err('pero el endpoint de conversaciones no quedo capturado.');
  _err('');
  _err('Como descubrirlo: en moescape.ai abre un chat, F12 > Network, filtra por');
  _err('"chat" o "message" y copia la URL + body de la peticion que devuelve el');
  _err('historial. Con eso se puede completar este script.');
})();`;

const EMOCHI = `(async () => {
${COMMON}
  _err('Emochi: el backend es FlowGPT y responde 403 sin sesion (verificado).');
  _err('');
  _err('La extension SI importa el personaje (parsea el HTML publico de la pagina),');
  _err('pero los endpoints de chat no estan documentados ni capturados.');
  _err('');
  _err('Para descubrirlos: emochi.com > un chat > F12 > Network > busca peticiones');
  _err('a emochi-backend-k8s.flowgpt.com que devuelvan mensajes.');
})();`;

/**
 * Metadatos de cada sitio soportado por el exportador de chats.
 * @type {Record<string, {label: string, script: string, status: 'ok'|'partial'|'no', note: string}>}
 */
export const CHAT_EXPORT_SCRIPTS = {
  tipsy: {
    label: 'Tipsy.chat',
    status: 'ok',
    note: 'API REST pública, token en cookie. Verificado contra la captura.',
    script: TIPSY,
  },
  juicychat: {
    label: 'JuicyChat.ai',
    status: 'partial',
    note: 'El listado de chats está confirmado, pero el endpoint que devuelve los mensajes no se capturó. Si falla, ajústalo en la constante MSG_PATH del script.',
    script: JUICYCHAT,
  },
  moescape: {
    label: 'Moescape.ai',
    status: 'no',
    note: 'No hay endpoint de historial confirmado. La importación de personajes sí funciona.',
    script: MOESCAPE,
  },
  emochi: {
    label: 'Emochi.com',
    status: 'no',
    note: 'Backend FlowGPT, responde 403 sin sesión. La importación de personajes sí funciona.',
    script: EMOCHI,
  },
};

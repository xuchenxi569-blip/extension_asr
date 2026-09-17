/**
 * 访问本机转写服务。
 * Chrome 会拦一部分「网页 → 电脑自己」的请求；扩展里要多试几种方式。
 */

const DEFAULT_ORIGIN = 'http://127.0.0.1:8787';

export function trimBase(url) {
  return String(url || '').replace(/\/+$/, '');
}

function asrOrigin(baseUrl) {
  try {
    const raw = String(baseUrl || DEFAULT_ORIGIN).replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
    const parsed = new URL(raw, DEFAULT_ORIGIN);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

function asrPath(baseUrl, path) {
  return new URL(path, `${asrOrigin(baseUrl)}/`).href;
}

function looksLikeHtml(raw) {
  return /^\s*<!doctype html/i.test(raw || '') || /^\s*<html[\s>]/i.test(raw || '');
}

function rememberOrigin(origin) {
  try {
    chrome.storage?.local?.set({ wsUrl: origin }).catch(() => {});
  } catch { /* 非扩展环境 */ }
}

async function readJsonBody(res) {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) return { data: null, raw: '' };
  if (looksLikeHtml(trimmed)) return { data: null, raw: trimmed, html: true };
  try {
    return { data: JSON.parse(trimmed), raw: trimmed };
  } catch {
    return { data: null, raw: trimmed.slice(0, 180) };
  }
}

function pickSessionId(res, data) {
  const fromHeader = res.headers.get('x-session-id') || res.headers.get('X-Session-Id');
  if (fromHeader) return fromHeader;
  if (!data || typeof data !== 'object') return '';
  const id = data.sessionId || data.session_id || data.id;
  return typeof id === 'string' && id ? id : '';
}

export async function fetchLoopback(url, init = {}) {
  const options = {
    cache: 'no-store',
    ...init,
  };
  if (!options.signal) options.signal = AbortSignal.timeout(8000);

  const attempts = [
    options,
    { ...options, targetAddressSpace: 'loopback' },
  ];

  let lastResponse = null;
  let lastError = null;

  for (const attempt of attempts) {
    try {
      const body = attempt.body;
      const attemptInit = body instanceof ArrayBuffer
        ? { ...attempt, body: body.slice(0) }
        : attempt;
      const res = await fetch(url, attemptInit);
      lastResponse = res;
      if (!res.ok) continue;
      const probe = res.clone();
      const text = await probe.text();
      if (looksLikeHtml(text)) continue;
      if (text.trim() || res.headers.get('x-session-id')) return res;
    } catch (err) {
      lastError = err;
      const name = String(err?.name || '');
      const msg = String(err?.message || '');
      if (name === 'TimeoutError' || /timed out|aborted/i.test(msg)) break;
    }
  }

  if (lastResponse) return lastResponse;
  if (lastError) {
    const msg = String(lastError.message || lastError);
    if (/timed out|TimeoutError|aborted/i.test(`${lastError.name || ''} ${msg}`)) {
      throw new Error('等识别结果超时了。云端模型还没回，或这个模型不走转写接口。');
    }
    throw lastError;
  }
  throw new Error('无法连接本机转写服务');
}

async function isAsrBackend(origin) {
  const res = await fetchLoopback(asrPath(origin, '/'), {
    signal: AbortSignal.timeout(2500),
  });
  const { data, html } = await readJsonBody(res);
  return Boolean(res.ok && !html && data?.service === 'extension-asr-backend');
}

/** 找到真正的转写服务地址。成功返回 origin，失败返回空字符串。 */
export async function pingAsr(baseUrl) {
  const candidates = [asrOrigin(baseUrl), DEFAULT_ORIGIN];
  const seen = new Set();
  for (const origin of candidates) {
    if (seen.has(origin)) continue;
    seen.add(origin);
    try {
      if (await isAsrBackend(origin)) {
        if (origin !== asrOrigin(baseUrl)) rememberOrigin(origin);
        return origin;
      }
    } catch { /* 试下一个 */ }
  }
  return '';
}

/** 问本机有哪些实测可用的识别模型。失败返回空清单，界面自己兜底。 */
export async function fetchAsrModels(baseUrl) {
  try {
    const res = await fetchLoopback(asrPath(baseUrl, '/models'), {
      signal: AbortSignal.timeout(4000),
    });
    const { data } = await readJsonBody(res);
    if (!Array.isArray(data?.models)) return { current: '', models: [] };
    return { current: data.current || '', models: data.models };
  } catch {
    return { current: '', models: [] };
  }
}

async function tryStartAt(origin, model) {
  const url = asrPath(origin, '/session/start');
  const modelHeader = model ? { 'x-asr-model': model } : {};
  const tries = [
    { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...modelHeader }, body: '{}' },
    { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'text/plain', ...modelHeader }, body: 'start' },
    { method: 'GET', headers: { Accept: 'application/json', ...modelHeader } },
  ];

  let lastMessage = '';
  for (const init of tries) {
    try {
      const res = await fetchLoopback(url, init);
      const { data, raw, html } = await readJsonBody(res);
      if (html) {
        lastMessage = 'html';
        continue;
      }
      const sessionId = pickSessionId(res, data);
      if (res.ok && sessionId) {
        return { baseUrl: origin, sessionId, model: model || '' };
      }
      lastMessage = data?.error || `HTTP ${res.status}${raw ? ` ${raw.slice(0, 80)}` : ''}`;
    } catch (err) {
      lastMessage = err?.message || String(err);
    }
  }
  return { error: lastMessage };
}

export async function startAsrSession(baseUrl, model = '') {
  const configured = asrOrigin(baseUrl);
  const first = await tryStartAt(configured, model);
  if (first.sessionId) return first;

  if (configured !== DEFAULT_ORIGIN) {
    const fallback = await tryStartAt(DEFAULT_ORIGIN, model);
    if (fallback.sessionId) {
      rememberOrigin(DEFAULT_ORIGIN);
      return fallback;
    }
  }

  if (first.error === 'html' || !first.error) {
    throw new Error(`填的地址 ${configured} 返回的是网页，不是转写服务。请把侧边栏地址改成 ${DEFAULT_ORIGIN}`);
  }
  throw new Error(
    /failed to fetch/i.test(first.error)
      ? `连不上转写服务 ${configured}。请确认 start.bat 窗口还开着，地址是 ${DEFAULT_ORIGIN}`
      : `转写服务已开着，但创建会话失败：${first.error}`
  );
}

export async function sendPcmChunk(asrHttp, buffer) {
  if (!asrHttp) return { events: [] };
  const payload = buffer instanceof ArrayBuffer
    ? buffer
    : (buffer?.buffer instanceof ArrayBuffer ? buffer.buffer : buffer);

  const res = await fetchLoopback(asrPath(asrHttp.baseUrl, '/transcribe'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'x-session-id': asrHttp.sessionId,
    },
    body: payload,
    signal: AbortSignal.timeout(90000),
  });
  const { data } = await readJsonBody(res);
  return { ok: res.ok, data: data || {} };
}

export async function stopAsrSession(asrHttp) {
  if (!asrHttp) return [];
  try {
    const res = await fetchLoopback(asrPath(asrHttp.baseUrl, '/session/stop'), {
      method: 'POST',
      headers: { 'x-session-id': asrHttp.sessionId },
      signal: AbortSignal.timeout(90000),
    });
    const { data } = await readJsonBody(res);
    return data?.events || [];
  } catch {
    return [];
  }
}

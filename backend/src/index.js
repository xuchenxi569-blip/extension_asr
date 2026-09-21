/**
 * Extension ASR 网关入口
 * 主路径用 HTTP 传音频（Chrome 会拦本机 WebSocket），WebSocket 仍保留给调试。
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { createMockAsrSession } from './asr/mock.js';
import { createOpenaiCompatibleSession } from './asr/openai-compatible.js';
import { ASR_MODELS, resolveModel } from './asr/models.js';

function loadEnv() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv();

const PREFERRED_PORT = Number(process.env.PORT) || 8787;
const PORT_RANGE = 20;
const ASR_PROVIDER = process.env.ASR_PROVIDER || 'mock';
const CHUNK_MS = 800;
const httpSessions = new Map();

const DEFAULT_MODEL = process.env.ASR_MODEL || 'whisper-1';

function createAsrSession(requestedModel) {
  if (ASR_PROVIDER === 'openai-compatible') {
    const apiKey = process.env.ASR_API_KEY;
    if (!apiKey) {
      throw new Error('ASR_PROVIDER=openai-compatible 时需要在 .env 里填写 ASR_API_KEY');
    }
    const model = resolveModel(requestedModel, DEFAULT_MODEL);
    if (/SenseVoiceSmall/i.test(model)) {
      console.warn(`[asr] 警告：${model} 在 /v1/audio/transcriptions 上实测不回包，会一直超时。请把 .env 的 ASR_MODEL 改成 TeleAI/TeleSpeechASR。`);
    }
    return createOpenaiCompatibleSession({
      apiKey,
      baseUrl: process.env.ASR_BASE_URL || 'https://api.openai.com',
      model,
      language: process.env.ASR_LANGUAGE || 'zh',
      chunkMs: Number(process.env.ASR_CHUNK_MS) || 5000,
      timeoutMs: Number(process.env.ASR_TIMEOUT_MS) || 60000,
    });
  }
  return createMockAsrSession();
}

function setCors(res, req) {
  const origin = req?.headers?.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  const requestedHeaders = req?.headers?.['access-control-request-headers'];
  res.setHeader(
    'Access-Control-Allow-Headers',
    requestedHeaders || 'content-type, x-session-id, x-asr-model'
  );
  res.setHeader('Access-Control-Expose-Headers', 'x-session-id');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Allow-Local-Network', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res, req, status, body) {
  setCors(res, req);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function startHttpSession(req, res) {
  try {
    const requestedModel = req.headers['x-asr-model'];
    const asr = createAsrSession(requestedModel);
    const id = randomUUID();
    httpSessions.set(id, { asr, audioOffsetMs: 0, lastActive: Date.now() });
    setCors(res, req);
    res.setHeader('X-Session-Id', id);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, sessionId: id }));
  } catch (err) {
    sendJson(res, req, 500, { error: err.message || String(err) });
  }
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function getHttpSession(id) {
  const session = httpSessions.get(id);
  if (!session) return null;
  session.lastActive = Date.now();
  return session;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const pathname = url.pathname.replace(/\/{2,}/g, '/') || '/';

  if (req.method === 'OPTIONS') {
    setCors(res, req);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && (pathname === '/' || pathname === '/health')) {
    sendJson(res, req, 200, {
      service: 'extension-asr-backend',
      status: 'ok',
      provider: ASR_PROVIDER,
      transport: ['http', 'websocket'],
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/models') {
    sendJson(res, req, 200, {
      service: 'extension-asr-backend',
      current: DEFAULT_MODEL,
      models: ASR_MODELS,
    });
    return;
  }

  if ((req.method === 'POST' || req.method === 'GET') && pathname === '/session/start') {
    startHttpSession(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/transcribe') {
    const id = req.headers['x-session-id'];
    const session = getHttpSession(id);
    if (!session) {
      sendJson(res, req, 404, { error: 'NO_SESSION' });
      return;
    }
    try {
      const pcm = await readBody(req);
      session.audioOffsetMs += CHUNK_MS;
      const events = await session.asr.processChunk(pcm, session.audioOffsetMs);
      sendJson(res, req, 200, { events });
    } catch (err) {
      sendJson(res, req, 500, { events: [{ type: 'error', text: err.message || String(err) }] });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/session/stop') {
    const id = req.headers['x-session-id'];
    const session = httpSessions.get(id);
    if (!session) {
      sendJson(res, req, 200, { events: [] });
      return;
    }
    const events = await session.asr.close?.() || [];
    httpSessions.delete(id);
    sendJson(res, req, 200, { events });
    return;
  }

  sendJson(res, req, 404, { error: 'NOT_FOUND' });
});

function attachWebSocket() {
  const wss = new WebSocketServer({ server, path: '/ws/transcribe' });

  wss.on('connection', (ws) => {
    let audioOffsetMs = 0;
    let asr;
    try {
      asr = createAsrSession();
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', text: err.message }));
      ws.close();
      return;
    }

    let queue = Promise.resolve();

    ws.on('message', (data, isBinary) => {
      queue = queue.then(async () => {
        if (!isBinary) {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'session.start') audioOffsetMs = 0;
            if (msg.type === 'session.stop') {
              const events = await asr.close();
              for (const event of events) {
                if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
              }
            }
          } catch { /* ignore */ }
          return;
        }

        audioOffsetMs += CHUNK_MS;
        const pcm = data instanceof ArrayBuffer ? Buffer.from(data) : data;
        const events = await asr.processChunk(pcm, audioOffsetMs);
        for (const event of events) {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
        }
      }).catch((err) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'error', text: err.message || String(err) }));
        }
      });
    });

    ws.on('close', () => {
      asr?.close?.();
    });
  });
}

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, session] of httpSessions) {
    if (session.lastActive < cutoff) {
      session.asr.close?.();
      httpSessions.delete(id);
    }
  }
}, 60 * 1000).unref();

function listenOnAvailablePort(preferred) {
  const last = preferred + PORT_RANGE;
  let port = preferred;

  const onError = (err) => {
    if (err.code === 'EADDRINUSE' && port < last) {
      console.warn(`[extension-asr-backend] 端口 ${port} 被占用，改试 ${port + 1}`);
      port += 1;
      server.listen(port, '127.0.0.1');
      return;
    }
    console.error(`[extension-asr-backend] 无法启动：${err.message}`);
    process.exit(1);
  };

  server.on('error', onError);
  server.listen(port, '127.0.0.1', () => {
    server.off('error', onError);
    const actual = server.address().port;
    if (actual !== preferred) {
      console.warn(`[extension-asr-backend] ${preferred} 被占用，已改用 ${actual}`);
    }
    attachWebSocket();
    console.log(`[extension-asr-backend] listening on http://127.0.0.1:${actual}`);
    console.log(`[extension-asr-backend] HTTP: POST http://127.0.0.1:${actual}/transcribe`);
    console.log(`[extension-asr-backend] ASR_PROVIDER=${ASR_PROVIDER}`);
  });
}

listenOnAvailablePort(PREFERRED_PORT);

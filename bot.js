import dotenv from 'dotenv';
import axios from 'axios';
import WebSocket from 'ws';
import crypto from 'node:crypto';

dotenv.config();

const requiredEnv = ['MISSKEY_BASE_URL', 'MISSKEY_TOKEN', 'LLM_MODEL'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`[fatal] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase();
}

const config = {
  misskeyBaseUrl: trimTrailingSlash(process.env.MISSKEY_BASE_URL),
  misskeyWsUrl: process.env.MISSKEY_WS_URL?.trim(),
  misskeyToken: process.env.MISSKEY_TOKEN,
  misskeyChannelId: process.env.MISSKEY_CHANNEL_ID?.trim() || '',
  botUsernameOverride: process.env.BOT_USERNAME?.trim() || '',
  botUserIdOverride: process.env.BOT_USER_ID?.trim() || '',
  llmApiUrl: trimTrailingSlash(process.env.LLM_API_URL?.trim() || 'http://127.0.0.1:11434/v1/chat/completions'),
  llmApiKey: process.env.LLM_API_KEY?.trim() || 'ollama',
  llmModel: process.env.LLM_MODEL,
  maxMemory: Math.max(0, parseNumber(process.env.MAX_MEMORY, 20)),
  maxTokens: Math.max(1, parseNumber(process.env.MAX_TOKENS, 300)),
  temperature: parseNumber(process.env.TEMPERATURE, 0.8),
  requestTimeoutMs: Math.max(1000, parseNumber(process.env.REQUEST_TIMEOUT_MS, 120000)),
  systemPrompt:
    process.env.SYSTEM_PROMPT?.trim() ||
    'You are a friendly Misskey bot. Reply naturally in Korean unless the user clearly uses another language.',
  enableAutoPost: parseBoolean(process.env.ENABLE_AUTO_POST, false),
  autoPostPrompt:
    process.env.AUTO_POST_PROMPT?.trim() ||
    'Write a short, natural social post suitable for Misskey. Avoid hashtags unless relevant.',
  autoPostMinMinutes: Math.max(1, parseNumber(process.env.AUTO_POST_MIN_MINUTES, 30)),
  autoPostMaxMinutes: Math.max(1, parseNumber(process.env.AUTO_POST_MAX_MINUTES, 240)),
  replyVisibilityMode: process.env.REPLY_VISIBILITY_MODE?.trim().toLowerCase() || 'inherit',
  replyDefaultVisibility: process.env.REPLY_DEFAULT_VISIBILITY?.trim().toLowerCase() || 'home',
  inheritLocalOnly: parseBoolean(process.env.INHERIT_LOCAL_ONLY, true),
  forceLocalOnly: parseBoolean(process.env.FORCE_LOCAL_ONLY, false),
  accessMode: process.env.ACCESS_MODE?.trim().toLowerCase() || 'following_or_local',
  allowedInstance: normalizeHost(process.env.ALLOWED_INSTANCE || 'gameguard.moe'),
  autoFollowBack: parseBoolean(process.env.AUTO_FOLLOW_BACK, false),
  autoFollowLocalOnly: parseBoolean(process.env.AUTO_FOLLOW_LOCAL_ONLY, false),
  maxOutputChars: Math.max(10, parseNumber(process.env.MAX_OUTPUT_CHARS, 3000)),
  relationDebug: parseBoolean(process.env.RELATION_DEBUG, false),
  logLevel: process.env.LOG_LEVEL?.trim().toLowerCase() || 'info',
};

const misskeyWsUrl = config.misskeyWsUrl
  ? trimTrailingSlash(config.misskeyWsUrl)
  : `${config.misskeyBaseUrl.replace(/^http/i, (m) => (m.toLowerCase() === 'https' ? 'wss' : 'ws'))}`;

const misskeyHttp = axios.create({
  baseURL: config.misskeyBaseUrl,
  timeout: config.requestTimeoutMs,
  headers: {
    Authorization: `Bearer ${config.misskeyToken}`,
    'Content-Type': 'application/json',
  },
});

const llmHttp = axios.create({ timeout: config.requestTimeoutMs });

const memoryByConversation = new Map();
const processedNoteIds = new Set();
const processedNoteTtlMs = 10 * 60 * 1000;
const recentFollowbackUserIds = new Set();
const recentFollowbackTtlMs = 60 * 1000;

let botProfile = {
  id: config.botUserIdOverride || null,
  username: config.botUsernameOverride || null,
  name: null,
};

let ws = null;
let pingInterval = null;
let reconnectTimer = null;
let currentBackoffMs = 5000;
let autoPostTimer = null;

function log(level, message, extra = undefined) {
  const order = { error: 0, warn: 1, info: 2, debug: 3 };
  const current = order[config.logLevel] ?? order.info;
  const target = order[level] ?? order.info;
  if (target > current) return;
  const line = `[${level}] ${message}`;
  if (extra !== undefined) {
    console.log(line, extra);
  } else {
    console.log(line);
  }
}

function getSenderId(note) {
  return note?.userId || note?.user?.id || null;
}

function getConversationKey(note) {
  return getSenderId(note) || `note:${note?.id || 'unknown'}`;
}

function getConversationHistory(key) {
  return memoryByConversation.get(key) || [];
}

function addToConversationMemory(key, role, content) {
  if (config.maxMemory <= 0) return;
  const trimmed = String(content || '').trim();
  if (!trimmed) return;
  const current = memoryByConversation.get(key) || [];
  current.push({ role, content: trimmed });
  while (current.length > config.maxMemory) current.shift();
  memoryByConversation.set(key, current);
}

function pruneProcessedNote(id) {
  processedNoteIds.add(id);
  setTimeout(() => processedNoteIds.delete(id), processedNoteTtlMs).unref?.();
}

function rememberRecentFollowback(userId) {
  recentFollowbackUserIds.add(userId);
  setTimeout(() => recentFollowbackUserIds.delete(userId), recentFollowbackTtlMs).unref?.();
}

function sanitizeUserText(text) {
  let output = String(text || '').trim();
  if (botProfile.username) {
    const escaped = botProfile.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    output = output.replace(new RegExp(`@${escaped}\\b`, 'gi'), '').trim();
  }
  return output;
}

function collapseWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function cutForMisskey(text) {
  const normalized = String(text || '').trim();
  if (normalized.length <= config.maxOutputChars) return normalized;
  return `${normalized.slice(0, Math.max(0, config.maxOutputChars - 1)).trimEnd()}…`;
}

function extractLlmText(data) {
  if (!data || typeof data !== 'object') return '';

  if (Array.isArray(data.choices) && data.choices[0]?.message?.content != null) {
    const content = data.choices[0].message.content;
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part?.type === 'text') return part.text || '';
          return '';
        })
        .join('')
        .trim();
    }
  }

  if (data.message?.content != null) {
    if (typeof data.message.content === 'string') return data.message.content.trim();
    if (Array.isArray(data.message.content)) {
      return data.message.content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part?.type === 'text') return part.text || '';
          return '';
        })
        .join('')
        .trim();
    }
  }

  if (typeof data.response === 'string') return data.response.trim();
  if (typeof data.output_text === 'string') return data.output_text.trim();
  return '';
}

function buildLlmHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (config.llmApiKey) headers.Authorization = `Bearer ${config.llmApiKey}`;
  return headers;
}

function isOllamaNativeApi(url) {
  return /\/api\/chat\/?$/i.test(url);
}

async function generateWithLlm(messages) {
  const url = config.llmApiUrl;
  const headers = buildLlmHeaders();

  const payload = isOllamaNativeApi(url)
    ? {
        model: config.llmModel,
        messages,
        stream: false,
        options: {
          temperature: config.temperature,
        },
      }
    : {
        model: config.llmModel,
        messages,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        stream: false,
      };

  const response = await llmHttp.post(url, payload, { headers });
  const text = extractLlmText(response.data);
  if (!text) {
    throw new Error('LLM returned an empty response.');
  }
  return text;
}

async function fetchBotProfile() {
  const response = await misskeyHttp.post('/api/i', {});
  const data = response.data || {};
  botProfile = {
    id: config.botUserIdOverride || data.id || null,
    username: config.botUsernameOverride || data.username || null,
    name: data.name || null,
  };
  if (!botProfile.id || !botProfile.username) {
    throw new Error('Could not determine bot profile from Misskey.');
  }
  return botProfile;
}

async function fetchUserRelation(userId) {
  try {
    const response = await misskeyHttp.post('/api/users/relation', { userId });
    const data = response.data;

    if (Array.isArray(data)) {
      return data[0] || {};
    }

    return data || {};
  } catch (error) {
    const details = error?.response?.data || error?.message || String(error);
    log('warn', 'Failed to fetch user relation.', { userId, details });
    return {};
  }
}

function isLocalInstanceUser(noteOrUser) {
  const host = normalizeHost(noteOrUser?.user?.host ?? noteOrUser?.host ?? '');
  return !host || host === config.allowedInstance;
}

function relationAllowsFollowing(relation) {
  return (
    relation?.isFollowing === true ||
    relation?.hasPendingFollowRequestFromYou === true
  );
}

function relationAllowsFollower(relation) {
  return (
    relation?.isFollowed === true ||
    relation?.hasPendingFollowRequestToYou === true
  );
}

function noteUserRelationAllowsFollowing(note) {
  const user = note?.user || {};
  return (
    user?.isFollowing === true ||
    user?.hasPendingFollowRequestFromYou === true
  );
}

function noteUserRelationAllowsFollower(note) {
  const user = note?.user || {};
  return (
    user?.isFollowed === true ||
    user?.hasPendingFollowRequestToYou === true
  );
}

async function isAllowedSender(note) {
  const userId = getSenderId(note);
  if (!userId) return false;

  if (config.accessMode === 'off') return true;
  if (isLocalInstanceUser(note)) return true;

  switch (config.accessMode) {
    case 'local_only':
      return false;

    case 'followers_only':
      if (noteUserRelationAllowsFollower(note)) return true;
      break;

    case 'following_only':
      if (noteUserRelationAllowsFollowing(note)) return true;
      break;

    case 'followers_or_local':
      if (noteUserRelationAllowsFollower(note)) return true;
      break;

    case 'following_or_local':
      if (noteUserRelationAllowsFollowing(note)) return true;
      break;

    case 'mutual_or_local':
      if (noteUserRelationAllowsFollowing(note) || noteUserRelationAllowsFollower(note)) {
        return true;
      }
      break;

    default:
      log('warn', 'Unknown ACCESS_MODE, falling back to following_or_local.', {
        accessMode: config.accessMode,
      });
      if (noteUserRelationAllowsFollowing(note)) return true;
      break;
  }

  const relation = await fetchUserRelation(userId);

  if (config.relationDebug) {
    log('info', 'Relation debug', {
      userId,
      username: note?.user?.username || null,
      host: note?.user?.host || null,
      relation,
    });
  }

  switch (config.accessMode) {
    case 'local_only':
      return false;
    case 'followers_only':
      return relationAllowsFollower(relation);
    case 'following_only':
      return relationAllowsFollowing(relation);
    case 'followers_or_local':
      return relationAllowsFollower(relation);
    case 'following_or_local':
      return relationAllowsFollowing(relation);
    case 'mutual_or_local':
      return relationAllowsFollowing(relation) || relationAllowsFollower(relation);
    case 'off':
      return true;
    default:
      return relationAllowsFollowing(relation);
  }
}

function buildReplyPayload({ note, text }) {
  const payload = {
    text: cutForMisskey(text),
    replyId: note.id,
  };

  const channelId = note.channelId || config.misskeyChannelId;
  if (channelId) payload.channelId = channelId;

  const shouldForceLocalOnly = config.forceLocalOnly;
  const shouldInheritLocalOnly = config.inheritLocalOnly && note.localOnly === true;
  if (shouldForceLocalOnly || shouldInheritLocalOnly) {
    payload.localOnly = true;
  }

  let visibility = config.replyDefaultVisibility;
  if (config.replyVisibilityMode === 'inherit' && note.visibility) {
    visibility = note.visibility;
  }

  payload.visibility = visibility;

  if (visibility === 'specified') {
    const senderId = getSenderId(note);
    const visibleUserIds = Array.isArray(note.visibleUserIds) && note.visibleUserIds.length > 0
      ? [...new Set(note.visibleUserIds)]
      : [senderId].filter(Boolean);
    payload.visibleUserIds = visibleUserIds;
  }

  return payload;
}

async function sendNote(payload) {
  await misskeyHttp.post('/api/notes/create', payload);
}

async function sendReply(text, note) {
  const payload = buildReplyPayload({ note, text });
  await sendNote(payload);
  log('info', 'Reply sent.', {
    replyTo: note.id,
    visibility: payload.visibility,
    channelId: payload.channelId || null,
  });
}

async function sendAutoPost(text) {
  const payload = {
    text: cutForMisskey(text),
    visibility: config.replyDefaultVisibility,
  };
  if (config.forceLocalOnly) payload.localOnly = true;
  if (config.misskeyChannelId) payload.channelId = config.misskeyChannelId;
  await sendNote(payload);
  log('info', 'Auto post sent.');
}

function buildMessagesForReply(note, cleanedUserText) {
  const conversationKey = getConversationKey(note);
  const history = getConversationHistory(conversationKey);

  const contextLines = [];
  if (note.reply?.text) {
    contextLines.push(`The user is replying to this note: ${collapseWhitespace(note.reply.text)}`);
  }
  if (note.cw) {
    contextLines.push(`Content warning on the incoming note: ${collapseWhitespace(note.cw)}`);
  }
  if (note.visibility) {
    contextLines.push(`Visibility of the incoming note: ${note.visibility}`);
  }
  if (note.channelId) {
    contextLines.push('This conversation is taking place inside a Misskey channel.');
  }

  const systemMessages = [{ role: 'system', content: config.systemPrompt }];

  if (contextLines.length > 0) {
    systemMessages.push({ role: 'system', content: contextLines.join('\n') });
  }

  return [
    ...systemMessages,
    ...history,
    { role: 'user', content: cleanedUserText },
  ];
}

async function handleIncomingNote(note) {
  if (!note || !note.id) return;
  if (processedNoteIds.has(note.id)) return;
  pruneProcessedNote(note.id);

  if (getSenderId(note) === botProfile.id) {
    return;
  }

  if (!(await isAllowedSender(note))) {
    log('info', 'Ignored note from unauthorized user.', {
      noteId: note.id,
      userId: getSenderId(note),
      username: note.user?.username || null,
      host: note.user?.host || null,
      accessMode: config.accessMode,
    });
    return;
  }

  const rawText = note.text || '';
  const cleanedUserText = sanitizeUserText(rawText);
  if (!cleanedUserText) {
    log('debug', 'Ignoring empty mention/reply after sanitization.', { noteId: note.id });
    return;
  }

  const conversationKey = getConversationKey(note);
  addToConversationMemory(conversationKey, 'user', cleanedUserText);

  try {
    const messages = buildMessagesForReply(note, cleanedUserText);
    const llmText = await generateWithLlm(messages);
    const replyText = cutForMisskey(llmText);
    if (!replyText) {
      log('warn', 'LLM reply was empty after trimming.', { noteId: note.id });
      return;
    }

    await sendReply(replyText, note);
    addToConversationMemory(conversationKey, 'assistant', replyText);
  } catch (error) {
    const apiError = error?.response?.data || error?.message || String(error);
    log('error', 'Failed to generate or send reply.', apiError);
  }
}

function shouldHandleEvent(eventType, note) {
  if (!note || !getSenderId(note)) return false;

  if (eventType === 'mention') {
    return true;
  }

  if (eventType !== 'reply') return false;

  const replyToBot = note.reply?.userId === botProfile.id || note.reply?.user?.id === botProfile.id;
  const mentionedBot = botProfile.username
    ? String(note.text || '').toLowerCase().includes(`@${botProfile.username.toLowerCase()}`)
    : false;

  return replyToBot || mentionedBot;
}

function extractFollowedUserId(body) {
  return body?.id ?? body?.userId ?? body?.user?.id ?? null;
}

async function followBackUser(user) {
  const userId = extractFollowedUserId(user);
  if (!userId) {
    log('warn', 'follow event did not include a usable user id.', user);
    return;
  }

  if (botProfile?.id && userId === botProfile.id) return;
  if (recentFollowbackUserIds.has(userId)) return;
  if (config.autoFollowLocalOnly && !isLocalInstanceUser(user)) {
    log('info', 'Skipped auto-follow for non-local user.', {
      userId,
      username: user?.username ?? null,
      host: user?.host ?? null,
    });
    return;
  }

  try {
    rememberRecentFollowback(userId);
    await misskeyHttp.post('/api/following/create', { userId });
    log('info', 'Auto-followed user.', {
      userId,
      username: user?.username ?? null,
      host: user?.host ?? null,
    });
  } catch (error) {
    const details = error?.response?.data || error?.message || String(error);
    log('warn', 'Failed to auto-follow user.', {
      userId,
      username: user?.username ?? null,
      host: user?.host ?? null,
      details,
    });
  }
}

function clearWebSocketTimers() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = currentBackoffMs;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, delay);
  reconnectTimer.unref?.();
  currentBackoffMs = Math.min(currentBackoffMs * 2, 60000);
  log('warn', `Reconnecting to Misskey in ${delay / 1000}s...`);
}

function startPingInterval() {
  if (pingInterval) clearInterval(pingInterval);
  pingInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 60000);
  pingInterval.unref?.();
}

function connectWebSocket() {
  clearWebSocketTimers();

  const streamUrl = `${misskeyWsUrl}/streaming?i=${encodeURIComponent(config.misskeyToken)}`;
  const socket = new WebSocket(streamUrl);
  ws = socket;

  socket.on('open', () => {
    currentBackoffMs = 5000;
    log('info', 'Connected to Misskey streaming API.');
    socket.send(
      JSON.stringify({
        type: 'connect',
        body: {
          channel: 'main',
          id: crypto.randomUUID(),
        },
      }),
    );
    startPingInterval();
  });

  socket.on('message', async (data) => {
    const raw = data.toString('utf-8');
    let message;
    try {
      message = JSON.parse(raw);
    } catch (error) {
      log('warn', 'Failed to parse WebSocket payload.', raw);
      return;
    }

    if (message.type !== 'channel') return;

    const type = message.body?.type;
    const body = message.body?.body;

    try {
      switch (type) {
        case 'mention':
        case 'reply':
          if (!shouldHandleEvent(type, body)) return;

          log('info', 'Received mention/reply.', {
            noteId: body?.id || null,
            eventType: type,
            from: body?.user?.username || getSenderId(body),
            host: body?.user?.host || null,
            visibility: body?.visibility || null,
            channelId: body?.channelId || null,
          });

          await handleIncomingNote(body);
          break;

        case 'follow':
        case 'followed':
          if (config.autoFollowBack) {
            await followBackUser(body);
          }
          break;

        default:
          break;
      }
    } catch (error) {
      const details = error?.response?.data || error?.message || String(error);
      log('error', 'Unhandled error while processing streaming event.', {
        eventType: type,
        details,
      });
    }
  });

  socket.on('error', (error) => {
    log('error', 'WebSocket error.', error?.message || String(error));
  });

  socket.on('close', (code, reasonBuffer) => {
    clearWebSocketTimers();
    if (ws === socket) ws = null;
    const reason = Buffer.isBuffer(reasonBuffer) ? reasonBuffer.toString('utf-8') : String(reasonBuffer || 'n/a');
    log('warn', `Disconnected from Misskey streaming API (code=${code}, reason=${reason}).`);
    scheduleReconnect();
  });
}

async function maybeSendAutoPost() {
  if (!config.enableAutoPost) return;
  try {
    const text = await generateWithLlm([
      { role: 'system', content: config.autoPostPrompt },
      { role: 'user', content: 'AUTO' },
    ]);
    await sendAutoPost(text);
  } catch (error) {
    const apiError = error?.response?.data || error?.message || String(error);
    log('error', 'Failed to create auto post.', apiError);
  }
}

function scheduleNextAutoPost() {
  if (!config.enableAutoPost) return;
  if (autoPostTimer) clearTimeout(autoPostTimer);
  const minMs = config.autoPostMinMinutes * 60 * 1000;
  const maxMs = Math.max(minMs, config.autoPostMaxMinutes * 60 * 1000);
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  autoPostTimer = setTimeout(async () => {
    await maybeSendAutoPost();
    scheduleNextAutoPost();
  }, delay);
  autoPostTimer.unref?.();
  log('info', `Next auto post scheduled in ${Math.round(delay / 60000)} minute(s).`);
}

async function main() {
  const profile = await fetchBotProfile();
  log('info', `Logged in as @${profile.username}${profile.name ? ` (${profile.name})` : ''}`);

  connectWebSocket();
  scheduleNextAutoPost();
  log('info', 'Bot is running.', {
    accessMode: config.accessMode,
    autoFollowBack: config.autoFollowBack,
    autoFollowLocalOnly: config.autoFollowLocalOnly,
    allowedInstance: config.allowedInstance,
    relationDebug: config.relationDebug,
  });
}

function shutdown(signal) {
  log('info', `Received ${signal}, shutting down.`);
  clearWebSocketTimers();
  if (autoPostTimer) {
    clearTimeout(autoPostTimer);
    autoPostTimer = null;
  }
  if (ws) {
    try {
      ws.close(1000, 'shutdown');
    } catch {}
    ws = null;
  }
  setTimeout(() => process.exit(0), 250).unref?.();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((error) => {
  const details = error?.response?.data || error?.message || String(error);
  console.error('[fatal] Failed to start bot.', details);
  process.exit(1);
});

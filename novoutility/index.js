import {
  Client,
  GatewayIntentBits,
  Events,
  MessageFlags,
  ContainerBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  MediaGalleryBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  AttachmentBuilder
} from 'discord.js';
import Database from 'better-sqlite3';
import { config } from 'dotenv';
import fs from 'node:fs';

config();

const DEFAULT_PREFIX = process.env.PREFIX || 'u.';
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

console.log('🔧 Iniciando bot...');
console.log(`🔑 Token carregado: ${TOKEN ? 'SIM' : 'NÃO'}`);
console.log(`🆔 Client ID: ${CLIENT_ID ? 'SIM' : 'NÃO'}`);
console.log(`📌 Prefixo: ${DEFAULT_PREFIX}`);

if (!TOKEN) {
  console.error('❌ DISCORD_TOKEN não encontrado no .env');
  process.exit(1);
}

const CONFIG_PATH = './config.json';
const sessions = new Map();
const permissionDrafts = new Map();
const buttonActions = new Map();
const selectActions = new Map();
const spamTracker = new Map();
const savedSelections = new Map();
const commandPermissionDrafts = new Map();
const commandPanels = new Map();
const logsPanels = new Map();
const autoRolePanels = new Map();

const DATABASE_DIR = './database';
const INSTAGRAM_DB_PATH = `${DATABASE_DIR}/instagram.db`;

if (!fs.existsSync(DATABASE_DIR)) {
  fs.mkdirSync(DATABASE_DIR, { recursive: true });
}

const igdb = new Database(INSTAGRAM_DB_PATH);

igdb.exec(`
CREATE TABLE IF NOT EXISTS instagram_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  author_id TEXT NOT NULL,
  author_tag TEXT NOT NULL,
  author_avatar TEXT,
  media_url TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS instagram_likes (
  post_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS instagram_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  user_tag TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS instagram_highlight_state (
  guild_id TEXT PRIMARY KEY,
  post_id INTEGER,
  message_id TEXT,
  user_id TEXT,
  updated_at INTEGER,
  last_post_id INTEGER
);
`);

igdb.exec(`
CREATE TABLE IF NOT EXISTS instapet_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  author_id TEXT NOT NULL,
  author_tag TEXT NOT NULL,
  author_avatar TEXT,
  media_url TEXT NOT NULL,
  caption TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS instapet_likes (
  post_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS instapet_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  user_tag TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS instapet_highlight_state (
  guild_id TEXT PRIMARY KEY,
  post_id INTEGER,
  message_id TEXT,
  user_id TEXT,
  updated_at INTEGER,
  last_post_id INTEGER
);
`);

function ensureInstagramColumn(table, column, type) {
  const cols = igdb.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) {
    igdb.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
  }
}

ensureInstagramColumn('instagram_highlight_state', 'last_post_id', 'INTEGER');
ensureInstagramColumn('instagram_posts', 'caption', 'TEXT');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// -------- CONFIG --------
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { guilds: {} };
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { guilds: {} };
  }
}

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(appConfig, null, 2));
}

function defaultGuildConfig() {
  return {
    antiSpam: {
      maxMessages: 5,
      intervalSeconds: 10,
      action: 'delete',
      muteRoleId: null,
      immuneRoleIds: []
    },
    permissions: {
      allowedUserIds: CLIENT_ID ? [CLIENT_ID] : [],
      allowedRoleIds: []
    },
    commands: {
      nuke: { allowedRoleIds: [] },
      clear: { allowedRoleIds: [] }
    },
    instagram: {
      postChannelId: null,
      highlightChannelId: null,
      highlightRoleId: null,
      storageChannelId: null,
      clearHighlightEnabled: false,
      clearHighlightAfterDays: 7,
      emojis: {
        like: '❤️',
        comment: '💬',
        info: '⋯',
        delete: '🗑️'
      }
    },
    instapet: {
      postChannelId: null,
      highlightChannelId: null,
      highlightRoleId: null,
      storageChannelId: null,
      clearHighlightEnabled: false,
      clearHighlightAfterDays: 7,
      emojis: {
        like: '❤️',
        comment: '💬',
        info: '⋯',
        delete: '🗑️'
      }
    },
    server: {
      logs: {
        bans: { ban: null, unban: null, kick: null },
        roles: { create: null, delete: null, update: null, add: null, remove: null },
        channels: { create: null, delete: null, update: null },
        mutes: { chat: null, voice: null },
        bots: { add: null },
        joins: { join: null, leave: null },
        messages: { delete: null, update: null },
        voice: { traffic: null }
      },
      autoRole: {
        enabled: false,
        memberRoleId: null,
        botRoleId: null,
        boosterRoleId: null
      }
    },
    savedEmbeds: []
  };
}

function defaultBotAppearance() {
  return {
    prefix: DEFAULT_PREFIX,
    username: null,
    avatarUrl: null,
    bannerUrl: null
  };
}

function getBotAppearance() {
  if (!appConfig.botAppearance) {
    appConfig.botAppearance = defaultBotAppearance();
    saveConfig();
  } else {
    const defaults = defaultBotAppearance();
    appConfig.botAppearance = { ...defaults, ...appConfig.botAppearance };
  }
  return appConfig.botAppearance;
}

function getPrefix() {
  return getBotAppearance().prefix || DEFAULT_PREFIX;
}

async function applyBotAppearance() {
  const appearance = getBotAppearance();
  if (!client.user) return;

  if (appearance.username) {
    await client.user.setUsername(appearance.username).catch(() => {});
  }
  if (appearance.avatarUrl) {
    await client.user.setAvatar(appearance.avatarUrl).catch(() => {});
  }
  if (appearance.bannerUrl) {
    await client.user.setBanner(appearance.bannerUrl).catch(() => {});
  }
}

function getGuildConfig(guildId) {
  if (!appConfig.guilds[guildId]) {
    appConfig.guilds[guildId] = defaultGuildConfig();
    saveConfig();
  }

  const cfg = appConfig.guilds[guildId];
  const defaults = defaultGuildConfig();

  if (!cfg.savedEmbeds) cfg.savedEmbeds = [];
  if (!cfg.permissions) cfg.permissions = defaults.permissions;
  if (!cfg.antiSpam) cfg.antiSpam = defaults.antiSpam;
  if (!cfg.commands) cfg.commands = defaults.commands;
  if (!cfg.commands.nuke) cfg.commands.nuke = { allowedRoleIds: [] };
  if (!cfg.commands.clear) cfg.commands.clear = { allowedRoleIds: [] };
  if (!cfg.instagram) cfg.instagram = defaults.instagram;
  if (!cfg.instagram.emojis) cfg.instagram.emojis = defaults.instagram.emojis;
  if (!cfg.instapet) cfg.instapet = defaults.instapet;
  if (!cfg.instapet.emojis) cfg.instapet.emojis = defaults.instapet.emojis;

  if (!cfg.server) cfg.server = defaults.server;
  cfg.server.logs = { ...defaults.server.logs, ...cfg.server.logs };
  cfg.server.logs.bans = { ...defaults.server.logs.bans, ...cfg.server.logs.bans };
  cfg.server.logs.roles = { ...defaults.server.logs.roles, ...cfg.server.logs.roles };
  cfg.server.logs.channels = { ...defaults.server.logs.channels, ...cfg.server.logs.channels };
  cfg.server.logs.mutes = { ...defaults.server.logs.mutes, ...cfg.server.logs.mutes };
  cfg.server.logs.bots = { ...defaults.server.logs.bots, ...cfg.server.logs.bots };
  cfg.server.logs.joins = { ...defaults.server.logs.joins, ...cfg.server.logs.joins };
  cfg.server.logs.messages = { ...defaults.server.logs.messages, ...cfg.server.logs.messages };
  cfg.server.logs.voice = { ...defaults.server.logs.voice, ...cfg.server.logs.voice };
  cfg.server.autoRole = { ...defaults.server.autoRole, ...cfg.server.autoRole };

  return cfg;
}

const appConfig = loadConfig();

function hydrateSavedActions() {
  for (const guildId of Object.keys(appConfig.guilds || {})) {
    const cfg = getGuildConfig(guildId);
    for (const embed of cfg.savedEmbeds || []) {
      if (embed.buttonActions) {
        for (const [customId, text] of Object.entries(embed.buttonActions)) {
          buttonActions.set(customId, { text });
        }
      }
    }
  }
}

hydrateSavedActions();

// -------- AUTH --------
function isAuthorized(member, guildConfig) {
  if (!member) return false;
  if (CLIENT_ID && member.id === CLIENT_ID) return true;

  const allowedUsers = guildConfig.permissions?.allowedUserIds || [];
  const allowedRoles = guildConfig.permissions?.allowedRoleIds || [];

  if (allowedUsers.includes(member.id)) return true;
  if (allowedRoles.length && member.roles?.cache?.some(r => allowedRoles.includes(r.id))) return true;

  return false;
}

function isCommandRoleAllowed(member, allowedRoleIds) {
  if (!member) return false;
  if (!allowedRoleIds?.length) return false;
  return member.roles?.cache?.some(r => allowedRoleIds.includes(r.id)) || false;
}

// -------- ANTI-SPAM --------
async function handleAntiSpam(message) {
  if (!message.guild || message.author.bot) return;

  const guildConfig = getGuildConfig(message.guild.id);
  const anti = guildConfig.antiSpam;

  const immuneRoles = anti.immuneRoleIds || [];
  if (immuneRoles.length && message.member?.roles.cache.some(r => immuneRoles.includes(r.id))) return;

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const windowMs = anti.intervalSeconds * 1000;

  const history = spamTracker.get(key) || [];
  const filtered = history.filter(t => now - t < windowMs);
  filtered.push(now);
  spamTracker.set(key, filtered);

  if (filtered.length <= anti.maxMessages) return;

  try {
    if (anti.action === 'delete') {
      await message.delete().catch(() => {});
    } else if (anti.action === 'mute') {
      if (anti.muteRoleId) {
        await message.member.roles.add(anti.muteRoleId).catch(() => {});
        await message.delete().catch(() => {});
      }
    } else if (anti.action === 'ban') {
      await message.guild.members.ban(message.author.id).catch(() => {});
    }
  } catch {}

  spamTracker.set(key, []);
}

// -------- UTIL --------
function createSession(userId, channelId, mode = 'normal', savedName = null, doc = null, targetChannelId = null) {
  const sessionId = `${userId}_${Date.now()}`;
  sessions.set(sessionId, {
    sessionId,
    userId,
    channelId,
    targetChannelId: targetChannelId || channelId,
    mode,
    savedName,
    doc: doc ? JSON.parse(JSON.stringify(doc)) : [{ components: [], accent_color: null }],
    builderMessageId: null,
    previewMessageId: null
  });
  return sessionId;
}

function getSessionById(sessionId) {
  return sessions.get(sessionId);
}

function getSavedEmbeds(guildId) {
  const cfg = getGuildConfig(guildId);
  return cfg.savedEmbeds || [];
}

function getServerConfig(guildId) {
  const cfg = getGuildConfig(guildId);
  if (!cfg.server) cfg.server = defaultGuildConfig().server;
  return cfg.server;
}

function parseLogTarget(raw) {
  const value = (raw || '').trim();
  if (!value) return null;

  if (value.includes('discord.com/api/webhooks') || value.includes('discordapp.com/api/webhooks')) {
    return value;
  }

  const match = value.match(/\d{15,}/);
  return match ? match[0] : value;
}

function formatLogTarget(value) {
  if (!value) return '—';
  if (/^https?:\/\//i.test(value)) return 'Webhook';
  if (/^\d+$/.test(value)) return `<#${value}>`;
  return value;
}

function extractButtonCustomIds(doc) {
  const ids = [];
  for (const block of doc[0]?.components || []) {
    if (block.type !== 1) continue;
    for (const comp of block.components || []) {
      if (comp.type === 2 && comp.customId) {
        ids.push(comp.customId);
      }
    }
  }
  return ids;
}

function buildNoticeContainer(title, lines) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(td =>
    td.setContent(`🧾 ${title}\n${lines.join('\n')}`)
  );
  return container;
}

// -------- INSTAGRAM --------
function getInstagramConfig(guildId) {
  const cfg = getGuildConfig(guildId);
  if (!cfg.instagram) cfg.instagram = defaultGuildConfig().instagram;
  return cfg.instagram;
}

async function resolvePostMediaUrl(channel, post) {
  if (post.media_url && post.media_url.startsWith('attachment://')) {
    const msg = await channel.messages.fetch(post.message_id).catch(() => null);
    const url = msg?.attachments?.first()?.url;
    if (url) {
      igdb.prepare('UPDATE instagram_posts SET media_url = ? WHERE id = ?').run(url, post.id);
      return url;
    }
  }
  return post.media_url;
}

function normalizeEmoji(input, fallback) {
  const trimmed = (input || '').trim();
  if (!trimmed) return fallback;

  const custom = trimmed.match(/^<a?:([^:]+):(\d+)>$/);
  if (custom) {
    return {
      name: custom[1],
      id: custom[2],
      animated: trimmed.startsWith('<a:')
    };
  }

  const unicodeOk = /\p{Extended_Pictographic}/u.test(trimmed);
  return unicodeOk ? trimmed : fallback;
}

async function getInstagramWebhook(channel) {
  const webhooks = await channel.fetchWebhooks();
  let hook = webhooks.find(w => w.name === 'Instagram' && w.owner?.id === client.user.id);

  if (!hook) {
    hook = await channel.createWebhook({ name: 'Instagram' });
  }

  return hook;
}

async function uploadToInstagramStorage(guildId, attachment) {
  const ig = getInstagramConfig(guildId);
  if (!ig.storageChannelId) return null;

  const channel = await client.channels.fetch(ig.storageChannelId).catch(() => null);
  if (!channel) return null;

  const sent = await channel.send({
    files: [{
      attachment: attachment.url,
      name: attachment.name || `instagram-${Date.now()}.png`
    }]
  });

  return sent.attachments.first()?.url || null;
}

function buildInstagramPostContainer({
  title,
  authorTag,
  mediaUrl,
  likeCount,
  commentCount,
  emojis,
  postId,
  caption
}) {
  const container = new ContainerBuilder();

  if (title) {
    container.addTextDisplayComponents(td => td.setContent(title));
  }

  const captionText = caption?.trim();
  const header = captionText
    ? `**${authorTag}** ${captionText}`
    : `**${authorTag}**`;

  container.addTextDisplayComponents(td => td.setContent(header));

  container.addSeparatorComponents(sep => sep.setSpacing(SeparatorSpacingSize.Small));

  const gallery = new MediaGalleryBuilder().addItems(item => item.setURL(mediaUrl));
  container.addMediaGalleryComponents(gallery);

  container.addSeparatorComponents(sep => sep.setSpacing(SeparatorSpacingSize.Small));

  const safeLike = normalizeEmoji(emojis.like, '❤️');
  const safeComment = normalizeEmoji(emojis.comment, '💬');
  const safeInfo = normalizeEmoji(emojis.info, 'ℹ️');
  const safeDelete = normalizeEmoji(emojis.delete, '🗑️');

  const likeButton = new ButtonBuilder()
    .setCustomId(`ig_like_${postId}`)
    .setLabel(String(likeCount))
    .setStyle(ButtonStyle.Secondary);
  if (safeLike) likeButton.setEmoji(safeLike);

  const commentButton = new ButtonBuilder()
    .setCustomId(`ig_comment_${postId}`)
    .setLabel(String(commentCount))
    .setStyle(ButtonStyle.Secondary);
  if (safeComment) commentButton.setEmoji(safeComment);

  const infoButton = new ButtonBuilder()
    .setCustomId(`ig_info_${postId}`)
    .setStyle(ButtonStyle.Secondary);
  if (safeInfo) infoButton.setEmoji(safeInfo);

  const deleteButton = new ButtonBuilder()
    .setCustomId(`ig_delete_${postId}`)
    .setStyle(ButtonStyle.Secondary);
  if (safeDelete) deleteButton.setEmoji(safeDelete);

  const row = new ActionRowBuilder().addComponents(
    likeButton,
    commentButton,
    infoButton,
    deleteButton
  );

  container.addActionRowComponents(row);
  return container;
}

function getInstagramStats(postId) {
  const likes = igdb.prepare('SELECT COUNT(*) as total FROM instagram_likes WHERE post_id = ?').get(postId).total;
  const comments = igdb.prepare('SELECT COUNT(*) as total FROM instagram_comments WHERE post_id = ?').get(postId).total;
  return { likes, comments };
}

async function updateInstagramMessage(guildId, channelId, messageId, postId) {
  const ig = getInstagramConfig(guildId);
  const post = igdb.prepare('SELECT * FROM instagram_posts WHERE id = ?').get(postId);
  if (!post) return;

  const { likes, comments } = getInstagramStats(postId);

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const hook = await getInstagramWebhook(channel).catch(() => null);
  if (!hook) return;

  await hook.editMessage(messageId, {
    components: [buildInstagramPostContainer({
      authorTag: post.author_tag,
      mediaUrl: post.media_url,
      likeCount: likes,
      commentCount: comments,
      emojis: ig.emojis,
      postId,
      caption: post.caption
    })],
    flags: MessageFlags.IsComponentsV2
  }).catch(err => console.error('[IG EDIT ERROR]', err));
}

function getHighlightState(guildId) {
  return igdb.prepare('SELECT * FROM instagram_highlight_state WHERE guild_id = ?').get(guildId);
}

function setHighlightState(guildId, data) {
  const stmt = igdb.prepare(`
    INSERT INTO instagram_highlight_state (guild_id, post_id, message_id, user_id, updated_at, last_post_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      post_id = excluded.post_id,
      message_id = excluded.message_id,
      user_id = excluded.user_id,
      updated_at = excluded.updated_at,
      last_post_id = excluded.last_post_id
  `);
  stmt.run(
    guildId,
    data.post_id ?? null,
    data.message_id ?? null,
    data.user_id ?? null,
    data.updated_at ?? null,
    data.last_post_id ?? null
  );
}

function getTopInstagramPost(guildId) {
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return igdb.prepare(`
    SELECT p.*, COUNT(l.user_id) as like_count
    FROM instagram_posts p
    LEFT JOIN instagram_likes l ON l.post_id = p.id
    WHERE p.guild_id = ? AND p.created_at >= ?
    GROUP BY p.id
    ORDER BY like_count DESC, p.created_at DESC
    LIMIT 1
  `).get(guildId, since);
}

async function updateHighlightIfNeeded(guildId) {
  const ig = getInstagramConfig(guildId);
  if (!ig.highlightChannelId) return;

  const top = getTopInstagramPost(guildId);
  const state = getHighlightState(guildId) || {};
  const lastPostId = state.last_post_id ?? state.post_id ?? null;

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  if (!top) {
    if (state.message_id) {
      const channel = await client.channels.fetch(ig.highlightChannelId).catch(() => null);
      if (channel) {
        await channel.messages.delete(state.message_id).catch(() => {});
      }
    }
    if (ig.highlightRoleId && state.user_id) {
      const member = await guild.members.fetch(state.user_id).catch(() => null);
      if (member) await member.roles.remove(ig.highlightRoleId).catch(() => {});
    }
    setHighlightState(guildId, {
      post_id: null,
      message_id: null,
      user_id: null,
      updated_at: Date.now(),
      last_post_id: lastPostId
    });
    return;
  }

  if (state.message_id && state.post_id === top.id) {
    const { likes, comments } = getInstagramStats(top.id);
    const channel = await client.channels.fetch(ig.highlightChannelId).catch(() => null);
    if (!channel) return;

    const msg = await channel.messages.fetch(state.message_id).catch(() => null);
    if (!msg) return;

    await msg.edit({
      components: [buildInstagramPostContainer({
        title: '🌟 Destaque',
        authorTag: top.author_tag,
        authorAvatar: top.author_avatar,
        mediaUrl: top.media_url,
        likeCount: likes,
        commentCount: comments,
        emojis: ig.emojis,
        postId: top.id,
        caption: top.caption
      })],
      flags: MessageFlags.IsComponentsV2
    });
    return;
  }

  if (!state.message_id && lastPostId === top.id) {
    return;
  }

  if (state.message_id) {
    const channel = await client.channels.fetch(ig.highlightChannelId).catch(() => null);
    if (channel) {
      await channel.messages.delete(state.message_id).catch(() => {});
    }
  }

  if (ig.highlightRoleId && state.user_id) {
    const member = await guild.members.fetch(state.user_id).catch(() => null);
    if (member) await member.roles.remove(ig.highlightRoleId).catch(() => {});
  }

  const { likes, comments } = getInstagramStats(top.id);
  const highlightChannel = await client.channels.fetch(ig.highlightChannelId).catch(() => null);
  if (!highlightChannel) return;

  const sent = await highlightChannel.send({
    components: [buildInstagramPostContainer({
      title: '🌟 Destaque',
      authorTag: top.author_tag,
      authorAvatar: top.author_avatar,
      mediaUrl: top.media_url,
      likeCount: likes,
      commentCount: comments,
      emojis: ig.emojis,
      postId: top.id,
      caption: top.caption
    })],
    flags: MessageFlags.IsComponentsV2
  });

  if (ig.highlightRoleId) {
    const member = await guild.members.fetch(top.author_id).catch(() => null);
    if (member) await member.roles.add(ig.highlightRoleId).catch(() => {});
  }

  setHighlightState(guildId, {
    post_id: top.id,
    message_id: sent.id,
    user_id: top.author_id,
    updated_at: Date.now(),
    last_post_id: top.id
  });
}

// -------- INSTA PET --------

function getInstaPetConfig(guildId) {
  const cfg = getGuildConfig(guildId);
  if (!cfg.instapet) cfg.instapet = defaultGuildConfig().instapet;
  return cfg.instapet;
}

async function getInstaPetWebhook(channel) {
  const webhooks = await channel.fetchWebhooks();
  let hook = webhooks.find(w => w.name === 'Insta Pet' && w.owner?.id === client.user.id);

  if (!hook) {
    hook = await channel.createWebhook({ name: 'Insta Pet' });
  }

  return hook;
}

async function uploadToInstaPetStorage(guildId, attachment) {
  const pet = getInstaPetConfig(guildId);
  if (!pet.storageChannelId) return null;

  const channel = await client.channels.fetch(pet.storageChannelId).catch(() => null);
  if (!channel) return null;

  const sent = await channel.send({
    files: [{
      attachment: attachment.url,
      name: attachment.name || `instapet-${Date.now()}.png`
    }]
  });

  return sent.attachments.first()?.url || null;
}

function buildInstaPetPostContainer({
  title,
  authorTag,
  mediaUrl,
  likeCount,
  commentCount,
  emojis,
  postId,
  caption
}) {
  const container = new ContainerBuilder();

  if (title) container.addTextDisplayComponents(td => td.setContent(title));

  const captionText = caption?.trim();
  const header = captionText
    ? `**${authorTag}** ${captionText}`
    : `**${authorTag}**`;

  container.addTextDisplayComponents(td => td.setContent(header));
  container.addSeparatorComponents(sep => sep.setSpacing(SeparatorSpacingSize.Small));

  const gallery = new MediaGalleryBuilder().addItems(item => item.setURL(mediaUrl));
  container.addMediaGalleryComponents(gallery);

  container.addSeparatorComponents(sep => sep.setSpacing(SeparatorSpacingSize.Small));

  const safeLike = normalizeEmoji(emojis.like, '❤️');
  const safeComment = normalizeEmoji(emojis.comment, '💬');
  const safeInfo = normalizeEmoji(emojis.info, 'ℹ️');
  const safeDelete = normalizeEmoji(emojis.delete, '🗑️');

  const likeButton = new ButtonBuilder()
    .setCustomId(`pet_like_${postId}`)
    .setLabel(String(likeCount))
    .setStyle(ButtonStyle.Secondary);
  if (safeLike) likeButton.setEmoji(safeLike);

  const commentButton = new ButtonBuilder()
    .setCustomId(`pet_comment_${postId}`)
    .setLabel(String(commentCount))
    .setStyle(ButtonStyle.Secondary);
  if (safeComment) commentButton.setEmoji(safeComment);

  const infoButton = new ButtonBuilder()
    .setCustomId(`pet_info_${postId}`)
    .setStyle(ButtonStyle.Secondary);
  if (safeInfo) infoButton.setEmoji(safeInfo);

  const deleteButton = new ButtonBuilder()
    .setCustomId(`pet_delete_${postId}`)
    .setStyle(ButtonStyle.Secondary);
  if (safeDelete) deleteButton.setEmoji(safeDelete);

  const row = new ActionRowBuilder().addComponents(
    likeButton,
    commentButton,
    infoButton,
    deleteButton
  );

  container.addActionRowComponents(row);
  return container;
}

function getInstaPetStats(postId) {
  const likes = igdb.prepare('SELECT COUNT(*) as total FROM instapet_likes WHERE post_id = ?').get(postId).total;
  const comments = igdb.prepare('SELECT COUNT(*) as total FROM instapet_comments WHERE post_id = ?').get(postId).total;
  return { likes, comments };
}

async function updateInstaPetMessage(guildId, channelId, messageId, postId) {
  const pet = getInstaPetConfig(guildId);
  const post = igdb.prepare('SELECT * FROM instapet_posts WHERE id = ?').get(postId);
  if (!post) return;

  const { likes, comments } = getInstaPetStats(postId);

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const hook = await getInstaPetWebhook(channel).catch(() => null);
  if (!hook) return;

  await hook.editMessage(messageId, {
    components: [buildInstaPetPostContainer({
      authorTag: post.author_tag,
      mediaUrl: post.media_url,
      likeCount: likes,
      commentCount: comments,
      emojis: pet.emojis,
      postId,
      caption: post.caption
    })],
    flags: MessageFlags.IsComponentsV2
  }).catch(err => console.error('[PET EDIT ERROR]', err));
}

function getInstaPetHighlightState(guildId) {
  return igdb.prepare('SELECT * FROM instapet_highlight_state WHERE guild_id = ?').get(guildId);
}

function setInstaPetHighlightState(guildId, data) {
  const stmt = igdb.prepare(`
    INSERT INTO instapet_highlight_state (guild_id, post_id, message_id, user_id, updated_at, last_post_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      post_id = excluded.post_id,
      message_id = excluded.message_id,
      user_id = excluded.user_id,
      updated_at = excluded.updated_at,
      last_post_id = excluded.last_post_id
  `);
  stmt.run(
    guildId,
    data.post_id ?? null,
    data.message_id ?? null,
    data.user_id ?? null,
    data.updated_at ?? null,
    data.last_post_id ?? null
  );
}

function getTopInstaPetPost(guildId) {
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return igdb.prepare(`
    SELECT p.*, COUNT(l.user_id) as like_count
    FROM instapet_posts p
    LEFT JOIN instapet_likes l ON l.post_id = p.id
    WHERE p.guild_id = ? AND p.created_at >= ?
    GROUP BY p.id
    ORDER BY like_count DESC, p.created_at DESC
    LIMIT 1
  `).get(guildId, since);
}

async function updateInstaPetHighlightIfNeeded(guildId) {
  const pet = getInstaPetConfig(guildId);
  if (!pet.highlightChannelId) return;

  const top = getTopInstaPetPost(guildId);
  const state = getInstaPetHighlightState(guildId) || {};
  const lastPostId = state.last_post_id ?? state.post_id ?? null;

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  if (!top) {
    if (state.message_id) {
      const channel = await client.channels.fetch(pet.highlightChannelId).catch(() => null);
      if (channel) await channel.messages.delete(state.message_id).catch(() => {});
    }
    if (pet.highlightRoleId && state.user_id) {
      const member = await guild.members.fetch(state.user_id).catch(() => null);
      if (member) await member.roles.remove(pet.highlightRoleId).catch(() => {});
    }
    setInstaPetHighlightState(guildId, {
      post_id: null,
      message_id: null,
      user_id: null,
      updated_at: Date.now(),
      last_post_id: lastPostId
    });
    return;
  }

  if (state.message_id && state.post_id === top.id) {
    const { likes, comments } = getInstaPetStats(top.id);
    const channel = await client.channels.fetch(pet.highlightChannelId).catch(() => null);
    if (!channel) return;

    const msg = await channel.messages.fetch(state.message_id).catch(() => null);
    if (!msg) return;

    await msg.edit({
      components: [buildInstaPetPostContainer({
        title: '🌟 Destaque',
        authorTag: top.author_tag,
        mediaUrl: top.media_url,
        likeCount: likes,
        commentCount: comments,
        emojis: pet.emojis,
        postId: top.id,
        caption: top.caption
      })],
      flags: MessageFlags.IsComponentsV2
    });
    return;
  }

  if (!state.message_id && lastPostId === top.id) return;

  if (state.message_id) {
    const channel = await client.channels.fetch(pet.highlightChannelId).catch(() => null);
    if (channel) await channel.messages.delete(state.message_id).catch(() => {});
  }

  if (pet.highlightRoleId && state.user_id) {
    const member = await guild.members.fetch(state.user_id).catch(() => null);
    if (member) await member.roles.remove(pet.highlightRoleId).catch(() => {});
  }

  const { likes, comments } = getInstaPetStats(top.id);
  const highlightChannel = await client.channels.fetch(pet.highlightChannelId).catch(() => null);
  if (!highlightChannel) return;

  const sent = await highlightChannel.send({
    components: [buildInstaPetPostContainer({
      title: '🌟 Destaque',
      authorTag: top.author_tag,
      mediaUrl: top.media_url,
      likeCount: likes,
      commentCount: comments,
      emojis: pet.emojis,
      postId: top.id,
      caption: top.caption
    })],
    flags: MessageFlags.IsComponentsV2
  });

  if (pet.highlightRoleId) {
    const member = await guild.members.fetch(top.author_id).catch(() => null);
    if (member) await member.roles.add(pet.highlightRoleId).catch(() => {});
  }

  setInstaPetHighlightState(guildId, {
    post_id: top.id,
    message_id: sent.id,
    user_id: top.author_id,
    updated_at: Date.now(),
    last_post_id: top.id
  });
}

// -------- PANELS --------
async function updateCommandsPanel(guildId) {
  const panel = commandPanels.get(guildId);
  if (!panel) return;

  const channel = await client.channels.fetch(panel.channelId).catch(() => null);
  if (!channel) return;

  const msg = await channel.messages.fetch(panel.messageId).catch(() => null);
  if (!msg) return;

  const container = buildCommandsContainer(guildId);
  await msg.edit({
    components: [container],
    flags: MessageFlags.IsComponentsV2
  });
}

async function updateLogsPanel(guildId) {
  const panel = logsPanels.get(guildId);
  if (!panel) return;

  const channel = await client.channels.fetch(panel.channelId).catch(() => null);
  if (!channel) return;

  const msg = await channel.messages.fetch(panel.messageId).catch(() => null);
  if (!msg) return;

  const container = buildServerLogsContainer(guildId);
  await msg.edit({
    components: [container],
    flags: MessageFlags.IsComponentsV2
  });
}

async function updateAutoRolePanel(guildId) {
  const panel = autoRolePanels.get(guildId);
  if (!panel) return;

  const channel = await client.channels.fetch(panel.channelId).catch(() => null);
  if (!channel) return;

  const msg = await channel.messages.fetch(panel.messageId).catch(() => null);
  if (!msg) return;

  const container = buildAutoRoleContainer(guildId);
  await msg.edit({
    components: [container],
    flags: MessageFlags.IsComponentsV2
  });
}

function buildMainMenuContainer() {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(td =>
    td.setContent(`# <:7BOX:1473022044764508436> Menu Principal\nEscolha uma função:`)
  );

  const menu = new StringSelectMenuBuilder()
    .setCustomId('main_menu')
    .setPlaceholder('Escolha uma função')
    .addOptions([
      new StringSelectMenuOptionBuilder()
        .setLabel('Aparência do bot')
        .setDescription('Trocar username, avatar, banner e prefixo')
        .setValue('appearance')
        .setEmoji('<a:emoji_84:1473021371331248180>'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Comandos')
        .setDescription('Configurar u.nuke e u.clear')
        .setValue('commands')
        .setEmoji('<a:emoji_84:1473021371331248180>'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Servidor')
        .setDescription('Logs e auto cargo')
        .setValue('server')
        .setEmoji('<a:emoji_84:1473021371331248180>'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Utilitários')
        .setDescription('Embeds e containers')
        .setValue('utilities')
        .setEmoji('<a:emoji_84:1473021371331248180>'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Entretenimento')
        .setDescription('Instagram e mais')
        .setValue('entertainment')
        .setEmoji('<a:emoji_84:1473021371331248180>'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Segurança')
        .setDescription('Anti-spam e proteção')
        .setValue('security')
        .setEmoji('<a:emoji_84:1473021371331248180>'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Permissões')
        .setDescription('Definir quem pode usar o bot')
        .setValue('permissions')
        .setEmoji('<a:emoji_84:1473021371331248180>'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Fechar menu')
        .setDescription('Apagar esta mensagem')
        .setValue('close')
        .setEmoji('<:blue:1473021654446903407>')
    ]);

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(menu)
  );

  return container;
}

function buildServerMenuContainer() {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(td =>
    td.setContent(`# <:b_gradientstar_hit:1473297513606811759> Servidor\nSelecione uma opção:`)
  );

  const menu = new StringSelectMenuBuilder()
    .setCustomId('server_menu')
    .setPlaceholder('Servidor')
    .addOptions([
      new StringSelectMenuOptionBuilder()
        .setLabel('Página inicial')
        .setDescription('Voltar ao menu principal')
        .setValue('home')
	.setEmoji('<:7BOX:1473022044764508436>'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Logs')
        .setDescription('Configurar logs do servidor')
        .setValue('logs')
	.setEmoji('<a:emoji_84:1473021371331248180>'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Auto cargo')
        .setDescription('Configurar cargos automáticos')
        .setValue('autorole')
	.setEmoji('<a:emoji_84:1473021371331248180>'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Fechar')
        .setDescription('Apagar esta mensagem')
        .setValue('close')
	.setEmoji('<:blue:1473021654446903407>')
    ]);

  container.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
  return container;
}

function buildUtilitiesMenuContainer() {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(td =>
    td.setContent(`# <:1428830845627531316:1473302670876868628> Utilitários\nSelecione uma opção:`)
  );

  const menu = new StringSelectMenuBuilder()
    .setCustomId('utilities_menu')
    .setPlaceholder('Utilitários')
    .addOptions([
      new StringSelectMenuOptionBuilder()
        .setLabel('Página inicial')
        .setDescription('Voltar ao menu principal')
        .setValue('home')
        .setEmoji('<:7BOX:1473022044764508436>'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Embed (Container)')
        .setDescription('Criar container personalizado')
        .setValue('embed')
        .setEmoji('<a:emoji_84:1473021371331248180>'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Embeds Save')
        .setDescription('Criar/editar embeds salvas')
        .setValue('embed_save')
        .setEmoji('<a:emoji_84:1473021371331248180>'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Fechar')
        .setDescription('Apagar esta mensagem')
        .setValue('close')
        .setEmoji('<:blue:1473021654446903407>')
    ]);

  container.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
  return container;
}

function buildEntertainmentMenuContainer() {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(td =>
    td.setContent(`# 🎮 Entretenimento\nSelecione uma opção:`)
  );

  const menu = new StringSelectMenuBuilder()
    .setCustomId('entertainment_menu')
    .setPlaceholder('Entretenimento')
    .addOptions([
      new StringSelectMenuOptionBuilder()
        .setLabel('Página inicial')
        .setDescription('Voltar ao menu principal')
        .setValue('home')
        .setEmoji('<:7BOX:1473022044764508436>'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Instagram')
        .setDescription('Configurar sistema de posts')
        .setValue('instagram')
        .setEmoji('<a:emoji_84:1473021371331248180>'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Insta Pet')
        .setDescription('Configurar sistema de posts de pets')
        .setValue('instapet')
        .setEmoji('🐾'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Fechar')
        .setDescription('Apagar esta mensagem')
        .setValue('close')
        .setEmoji('<:blue:1473021654446903407>')
    ]);

  container.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
  return container;
}

function buildInstaPetMenuContainer() {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(td =>
    td.setContent(`# 🐾 Insta Pet\nEscolha uma opção:`)
  );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('pet_config').setLabel('Configurar Insta Pet').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('pet_emojis').setLabel('Configurar Emojis').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('pet_close').setLabel('Fechar').setStyle(ButtonStyle.Danger)
  );

  container.addActionRowComponents(buttons);
  return container;
}

function buildInstaPetConfigContainer(guildId) {
  const pet = getInstaPetConfig(guildId);

  const postChannel = new ChannelSelectMenuBuilder()
    .setCustomId('pet_post_channel')
    .setPlaceholder('Canal de Postagem')
    .addChannelTypes(ChannelType.GuildText)
    .setMaxValues(1);

  const highlightChannel = new ChannelSelectMenuBuilder()
    .setCustomId('pet_highlight_channel')
    .setPlaceholder('Canal de Destaque')
    .addChannelTypes(ChannelType.GuildText)
    .setMaxValues(1);

  const storageChannel = new ChannelSelectMenuBuilder()
    .setCustomId('pet_storage_channel')
    .setPlaceholder('Canal de Arquivos (Pet Storage)')
    .addChannelTypes(ChannelType.GuildText)
    .setMaxValues(1);

  const highlightRole = new RoleSelectMenuBuilder()
    .setCustomId('pet_highlight_role')
    .setPlaceholder('Cargo de Destaque (opcional)')
    .setMaxValues(1);

  const clearHighlight = new StringSelectMenuBuilder()
    .setCustomId('pet_clear_highlight')
    .setPlaceholder('Limpar destaque? (opcional)')
    .addOptions([
      new StringSelectMenuOptionBuilder().setLabel('Desativado').setValue('off'),
      new StringSelectMenuOptionBuilder().setLabel('Ativado').setValue('on')
    ]);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('pet_close').setLabel('Fechar').setStyle(ButtonStyle.Danger)
  );

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(td =>
    td.setContent(
      `# ⚙️ Configure o Insta Pet\n` +
      `**Canal de Postagem:** ${pet.postChannelId ? `<#${pet.postChannelId}>` : '—'}\n` +
      `**Canal de Destaque:** ${pet.highlightChannelId ? `<#${pet.highlightChannelId}>` : '—'}\n` +
      `**Canal de Arquivos (Pet Storage):** ${pet.storageChannelId ? `<#${pet.storageChannelId}>` : '—'}\n` +
      `**Cargo de Destaque:** ${pet.highlightRoleId ? `<@&${pet.highlightRoleId}>` : '—'}\n` +
      `**Limpar destaque:** ${pet.clearHighlightEnabled ? 'Ativado' : 'Desativado'}`
    )
  );

  container.addActionRowComponents(new ActionRowBuilder().addComponents(postChannel));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(highlightChannel));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(storageChannel));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(highlightRole));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(clearHighlight));
  container.addActionRowComponents(buttons);

  return container;
}

function buildSecurityMenuContainer() {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(td =>
    td.setContent(`# 🛡️ Segurança\nSelecione uma opção:`)
  );

  const menu = new StringSelectMenuBuilder()
    .setCustomId('security_menu')
    .setPlaceholder('Segurança')
    .addOptions([
      new StringSelectMenuOptionBuilder()
        .setLabel('Página inicial')
        .setDescription('Voltar ao menu principal')
        .setValue('home')
        .setEmoji('<:7BOX:1473022044764508436>'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Anti-spam')
        .setDescription('Configurar proteção')
        .setValue('antispam')
        .setEmoji('<a:emoji_84:1473021371331248180>'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Fechar')
        .setDescription('Apagar esta mensagem')
        .setValue('close')
        .setEmoji('<:blue:1473021654446903407>')
    ]);

  container.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
  return container;
}

function buildServerLogsContainer(guildId) {
  const logs = getServerConfig(guildId).logs;

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(td =>
    td.setContent(
      `# 📑 Logs do Servidor\n` +
      `**Banimentos e expulsões**\n` +
      `Banimentos » ${formatLogTarget(logs.bans.ban)}\n` +
      `Desbanimentos » ${formatLogTarget(logs.bans.unban)}\n` +
      `Expulsões » ${formatLogTarget(logs.bans.kick)}\n\n` +
      `**Cargos**\n` +
      `Criar cargos » ${formatLogTarget(logs.roles.create)}\n` +
      `Deletar cargos » ${formatLogTarget(logs.roles.delete)}\n` +
      `Editar cargos » ${formatLogTarget(logs.roles.update)}\n` +
      `Adicionar cargos » ${formatLogTarget(logs.roles.add)}\n` +
      `Remover cargos » ${formatLogTarget(logs.roles.remove)}\n\n` +
      `**Canais**\n` +
      `Criar canais » ${formatLogTarget(logs.channels.create)}\n` +
      `Deletar canais » ${formatLogTarget(logs.channels.delete)}\n` +
      `Atualizar canais » ${formatLogTarget(logs.channels.update)}\n\n` +
      `**Membros silenciados**\n` +
      `Silenciados chat » ${formatLogTarget(logs.mutes.chat)}\n` +
      `Silenciados voz » ${formatLogTarget(logs.mutes.voice)}\n\n` +
      `**Bots adicionados**\n` +
      `Bots adicionados » ${formatLogTarget(logs.bots.add)}\n\n` +
      `**Entrada e saída**\n` +
      `Entrada de membros » ${formatLogTarget(logs.joins.join)}\n` +
      `Saída de membros » ${formatLogTarget(logs.joins.leave)}\n\n` +
      `**Mensagens**\n` +
      `Mensagens apagadas » ${formatLogTarget(logs.messages.delete)}\n` +
      `Mensagens atualizadas » ${formatLogTarget(logs.messages.update)}\n\n` +
      `**Tráfego de voz**\n` +
      `Tráfego de voz » ${formatLogTarget(logs.voice.traffic)}`
    )
  );

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('logs_bans').setLabel('Banimentos').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('logs_roles').setLabel('Cargos').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('logs_channels').setLabel('Canais').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('logs_mutes').setLabel('Membros silenciados').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('logs_bots').setLabel('Bots adicionados').setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('logs_joins').setLabel('Entrou/Saiu').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('logs_messages').setLabel('Mensagens').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('logs_voice').setLabel('Tráfego de voz').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('logs_back').setLabel('Voltar').setStyle(ButtonStyle.Danger)
  );

  container.addActionRowComponents(row1);
  container.addActionRowComponents(row2);

  return container;
}

function buildAutoRoleContainer(guildId) {
  const auto = getServerConfig(guildId).autoRole;

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(td =>
    td.setContent(
      `# 🧲 Auto Cargo\n` +
      `**Status:** ${auto.enabled ? 'Ativado' : 'Desativado'}\n` +
      `**Cargo membro:** ${auto.memberRoleId ? `<@&${auto.memberRoleId}>` : '—'}\n` +
      `**Cargo bot:** ${auto.botRoleId ? `<@&${auto.botRoleId}>` : '—'}\n` +
      `**Cargo booster:** ${auto.boosterRoleId ? `<@&${auto.boosterRoleId}>` : '—'}`
    )
  );

  const toggleButton = auto.enabled
    ? new ButtonBuilder().setCustomId('autorole_toggle').setLabel('Desativar').setStyle(ButtonStyle.Danger)
    : new ButtonBuilder().setCustomId('autorole_toggle').setLabel('Ativar').setStyle(ButtonStyle.Success);

  const row1 = new ActionRowBuilder().addComponents(
    toggleButton,
    new ButtonBuilder().setCustomId('autorole_back').setLabel('Voltar').setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('autorole_set_member').setLabel('Definir cargo membro').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('autorole_set_bot').setLabel('Definir cargo bot').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('autorole_set_booster').setLabel('Definir cargo booster').setStyle(ButtonStyle.Primary)
  );

  container.addActionRowComponents(row1);
  container.addActionRowComponents(row2);

  return container;
}

function buildCommandsContainer(guildId) {
  const cfg = getGuildConfig(guildId);

  const nukeRoles = cfg.commands.nuke.allowedRoleIds || [];
  const clearRoles = cfg.commands.clear.allowedRoleIds || [];

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(td =>
    td.setContent(
      `# 🧨 Comandos\n` +
      `**u.nuke**: ${nukeRoles.length ? nukeRoles.map(id => `<@&${id}>`).join(', ') : '—'}\n` +
      `**u.clear**: ${clearRoles.length ? clearRoles.map(id => `<@&${id}>`).join(', ') : '—'}`
    )
  );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cmd_perm_nuke').setLabel('Permissões u.nuke').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cmd_perm_clear').setLabel('Permissões u.clear').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cmd_close').setLabel('Fechar').setStyle(ButtonStyle.Danger)
  );

  container.addActionRowComponents(buttons);
  return container;
}

function buildAppearanceContainer() {
  const appearance = getBotAppearance();
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(td =>
    td.setContent(
      `# 🎛️ Aparência do bot\n` +
      `**Username:** ${appearance.username || '—'}\n` +
      `**Avatar URL:** ${appearance.avatarUrl || '—'}\n` +
      `**Banner URL:** ${appearance.bannerUrl || '—'}\n` +
      `**Prefixo:** ${appearance.prefix || DEFAULT_PREFIX}`
    )
  );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('appearance_username').setLabel('Username').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('appearance_avatar').setLabel('Avatar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('appearance_banner').setLabel('Banner').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('appearance_prefix').setLabel('Prefixo').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('appearance_close').setLabel('Fechar').setStyle(ButtonStyle.Danger)
  );

  container.addActionRowComponents(buttons);
  return container;
}

function buildSavedManagerContainer() {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(td =>
    td.setContent(`# 💾 Embeds Save\nEscolha uma ação:`)
  );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('saved_create').setLabel('Criar').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('saved_list').setLabel('Listar').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('saved_close').setLabel('Fechar').setStyle(ButtonStyle.Danger)
  );

  container.addActionRowComponents(buttons);
  return container;
}

function buildInstagramMenuContainer() {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(td =>
    td.setContent(`# 📸 Instagram\nEscolha uma opção:`)
  );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ig_config').setLabel('Configurar Instagram').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ig_emojis').setLabel('Configurar Emojis').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ig_close').setLabel('Fechar').setStyle(ButtonStyle.Danger)
  );

  container.addActionRowComponents(buttons);
  return container;
}

function buildInstagramConfigContainer(guildId) {
  const ig = getInstagramConfig(guildId);

  const postChannel = new ChannelSelectMenuBuilder()
    .setCustomId('ig_post_channel')
    .setPlaceholder('Canal de Postagem')
    .addChannelTypes(ChannelType.GuildText)
    .setMaxValues(1);

  const highlightChannel = new ChannelSelectMenuBuilder()
    .setCustomId('ig_highlight_channel')
    .setPlaceholder('Canal de Destaque')
    .addChannelTypes(ChannelType.GuildText)
    .setMaxValues(1);

  const storageChannel = new ChannelSelectMenuBuilder()
    .setCustomId('ig_storage_channel')
    .setPlaceholder('Canal de Arquivos (IG Storage)')
    .addChannelTypes(ChannelType.GuildText)
    .setMaxValues(1);

  const highlightRole = new RoleSelectMenuBuilder()
    .setCustomId('ig_highlight_role')
    .setPlaceholder('Cargo de Destaque (opcional)')
    .setMaxValues(1);

  const clearHighlight = new StringSelectMenuBuilder()
    .setCustomId('ig_clear_highlight')
    .setPlaceholder('Limpar destaque? (opcional)')
    .addOptions([
      new StringSelectMenuOptionBuilder().setLabel('Desativado').setValue('off'),
      new StringSelectMenuOptionBuilder().setLabel('Ativado').setValue('on')
    ]);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ig_close').setLabel('Fechar').setStyle(ButtonStyle.Danger)
  );

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(td =>
    td.setContent(
      `# ⚙️ Configure o Instagram\n` +
      `**Canal de Postagem:** ${ig.postChannelId ? `<#${ig.postChannelId}>` : '—'}\n` +
      `**Canal de Destaque:** ${ig.highlightChannelId ? `<#${ig.highlightChannelId}>` : '—'}\n` +
      `**Canal de Arquivos (IG Storage):** ${ig.storageChannelId ? `<#${ig.storageChannelId}>` : '—'}\n` +
      `**Cargo de Destaque:** ${ig.highlightRoleId ? `<@&${ig.highlightRoleId}>` : '—'}\n` +
      `**Limpar destaque:** ${ig.clearHighlightEnabled ? 'Ativado' : 'Desativado'}`
    )
  );

  container.addActionRowComponents(new ActionRowBuilder().addComponents(postChannel));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(highlightChannel));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(storageChannel));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(highlightRole));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(clearHighlight));
  container.addActionRowComponents(buttons);

  return container;
}

function buildSavedListContainer(guildId) {
  const saved = getSavedEmbeds(guildId);

  const container = new ContainerBuilder();
  const lines = saved.map(e => `• **${e.name}** — <#${e.channelId}>`);
  container.addTextDisplayComponents(td =>
    td.setContent(`# 💾 Embeds Salvas\n${lines.join('\n')}`)
  );

  const menu = new StringSelectMenuBuilder()
    .setCustomId('saved_select')
    .setPlaceholder('Selecione uma embed')
    .addOptions(
      saved.slice(0, 25).map(e =>
        new StringSelectMenuOptionBuilder()
          .setLabel(e.name)
          .setValue(e.name)
          .setDescription(`Canal: ${e.channelId}`)
      )
    );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('saved_delete').setLabel('Excluir selecionada').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('saved_close').setLabel('Fechar').setStyle(ButtonStyle.Secondary)
  );

  container.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
  container.addActionRowComponents(buttons);
  return container;
}

function buildAntiSpamContainer(guildId) {
  const cfg = getGuildConfig(guildId);
  const anti = cfg.antiSpam;

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(td =>
    td.setContent(
      `# 🛡️ Anti-spam\n` +
      `**Limite:** ${anti.maxMessages} mensagens\n` +
      `**Tempo:** ${anti.intervalSeconds}s\n` +
      `**Punição:** ${anti.action}\n` +
      `**Cargo Mutado:** ${anti.muteRoleId ? `<@&${anti.muteRoleId}>` : '—'}\n` +
      `**Cargos Imunes:** ${anti.immuneRoleIds.length ? anti.immuneRoleIds.map(id => `<@&${id}>`).join(', ') : '—'}`
    )
  );

  const actionMenu = new StringSelectMenuBuilder()
    .setCustomId('antispam_action')
    .setPlaceholder('Selecione a punição')
    .addOptions([
      new StringSelectMenuOptionBuilder().setLabel('Apagar mensagem').setValue('delete'),
      new StringSelectMenuOptionBuilder().setLabel('Mutar (cargo)').setValue('mute'),
      new StringSelectMenuOptionBuilder().setLabel('Banir').setValue('ban')
    ]);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('antispam_limits').setLabel('Limite/Tempo').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('antispam_muterole').setLabel('Cargo Mutado').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('antispam_immunes').setLabel('Cargos Imunes').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('antispam_close').setLabel('Fechar').setStyle(ButtonStyle.Danger)
  );

  container.addActionRowComponents(new ActionRowBuilder().addComponents(actionMenu));
  container.addActionRowComponents(buttons);

  return container;
}

function summarizeComponents(doc) {
  const components = doc.components || [];
  const textCount = components.filter(c => c.type === 10).length;
  const mediaCount = components.filter(c => c.type === 12).length;
  const sepCount = components.filter(c => c.type === 14).length;
  const rowCount = components.filter(c => c.type === 1).length;
  return `Texto: ${textCount} | Mídia: ${mediaCount} | Separadores: ${sepCount} | Linhas: ${rowCount}`;
}

function buildBuilderContainer(session) {
  const doc = session.doc[0];
  const container = new ContainerBuilder();

  if (doc.accent_color) {
    const hex = doc.accent_color.replace('#', '');
    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
      container.setAccentColor(parseInt(hex, 16));
    }
  }

  const title = session.mode === 'saved-edit'
    ? `# 🧩 Construtor (Editando: ${session.savedName})`
    : '# 🧩 Construtor de Container';

  container.addTextDisplayComponents(td =>
    td.setContent(
      `${title}\n` +
      `**Cor:** ${doc.accent_color || '—'}\n` +
      `**Resumo:** ${summarizeComponents(doc)}`
    )
  );

  const actionMenu = new StringSelectMenuBuilder()
    .setCustomId(`builder_action_${session.sessionId}`)
    .setPlaceholder('Adicionar / Configurar')
    .addOptions([
      new StringSelectMenuOptionBuilder().setLabel('Conteúdo').setValue('add_text').setEmoji('📝'),
      new StringSelectMenuOptionBuilder().setLabel('Imagem').setValue('add_image').setEmoji('🖼️'),
      new StringSelectMenuOptionBuilder().setLabel('Arquivo').setValue('add_file').setEmoji('📄'),
      new StringSelectMenuOptionBuilder().setLabel('Separador').setValue('add_separator').setEmoji('➖'),
      new StringSelectMenuOptionBuilder().setLabel('Botão').setValue('add_button').setEmoji('🔘'),
      new StringSelectMenuOptionBuilder().setLabel('Botão de link').setValue('add_link_button').setEmoji('🔗'),
      new StringSelectMenuOptionBuilder().setLabel('Menu de seleção').setValue('add_select_menu').setEmoji('🧭'),
      new StringSelectMenuOptionBuilder().setLabel('Definir cor').setValue('set_color').setEmoji('🎨')
    ]);

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(`builder_channel_${session.sessionId}`)
    .setPlaceholder('📨 Escolha o canal para enviar')
    .addChannelTypes(ChannelType.GuildText);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`builder_preview_${session.sessionId}`).setLabel('Preview').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`builder_send_${session.sessionId}`).setLabel('Enviar').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`builder_clear_${session.sessionId}`).setLabel('Limpar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`builder_cancel_${session.sessionId}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
  );

  container.addActionRowComponents(new ActionRowBuilder().addComponents(actionMenu));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(channelSelect));
  container.addActionRowComponents(buttons);

  return container;
}

function buildContainerFromDoc(session) {
  const doc = session.doc[0];
  const container = new ContainerBuilder();

  if (doc.accent_color) {
    const hex = doc.accent_color.replace('#', '');
    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
      container.setAccentColor(parseInt(hex, 16));
    }
  }

  for (const block of doc.components || []) {
    if (block.type === 10) {
      container.addTextDisplayComponents(td => td.setContent(block.content || ''));
    } else if (block.type === 14) {
      container.addSeparatorComponents(sep => sep.setSpacing(block.spacing || SeparatorSpacingSize.Small));
    } else if (block.type === 12) {
      const gallery = new MediaGalleryBuilder();
      for (const item of block.items || []) {
        if (item.media?.url) gallery.addItems(g => g.setURL(item.media.url));
      }
      container.addMediaGalleryComponents(gallery);
    } else if (block.type === 1) {
      const row = new ActionRowBuilder();
      for (const comp of block.components || []) {
        if (comp.type === 2) {
          const styleMap = {
            1: ButtonStyle.Primary,
            2: ButtonStyle.Secondary,
            3: ButtonStyle.Success,
            4: ButtonStyle.Danger,
            5: ButtonStyle.Link
          };
          const style = styleMap[Number(comp.style)] ?? ButtonStyle.Primary;

          const btn = new ButtonBuilder()
            .setLabel(comp.label || 'Botão')
            .setStyle(style)
            .setDisabled(!!comp.disabled);

          if (comp.emoji) btn.setEmoji(comp.emoji);

          if (style === ButtonStyle.Link) {
            btn.setURL(comp.url || 'https://discord.com');
          } else {
            btn.setCustomId(comp.customId);
          }

          row.addComponents(btn);
        } else if (comp.type === 3) {
          const select = new StringSelectMenuBuilder()
            .setCustomId(comp.customId)
            .setPlaceholder(comp.placeholder || 'Escolha...')
            .addOptions(
              comp.options?.slice(0, 25).map(o =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(o.label)
                  .setValue(o.value)
                  .setDescription(o.description || undefined)
              ) || []
            );
          row.addComponents(select);
        }
      }
      if (row.components.length) container.addActionRowComponents(row);
    }
  }

  if (!doc.components.length) {
    container.addTextDisplayComponents(td => td.setContent('Container criado com sucesso!'));
  }

  return container;
}

async function updatePreviewMessage(session) {
  if (!session.previewMessageId) return;

  const channel = await client.channels.fetch(session.channelId).catch(() => null);
  if (!channel) return;

  const msg = await channel.messages.fetch(session.previewMessageId).catch(() => null);
  if (!msg) return;

  const container = buildContainerFromDoc(session);
  await msg.edit({
    components: [container],
    flags: MessageFlags.IsComponentsV2
  });
}

async function updateBuilderMessage(session) {
  const channel = await client.channels.fetch(session.channelId).catch(() => null);
  if (!channel) return;

  const msg = await channel.messages.fetch(session.builderMessageId).catch(() => null);
  if (!msg) return;

  const container = buildBuilderContainer(session);
  await msg.edit({
    components: [container],
    flags: MessageFlags.IsComponentsV2
  });

  if (session.mode === 'saved-edit') {
    await updatePreviewMessage(session);
  }
}

// -------- EVENTS --------
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Bot online: ${c.user.tag}`);
  await applyBotAppearance();

  client.user.setPresence({
    activities: [
      {
        name: 'fazercash Bots',
        type: 1,
        url: 'https://www.twitch.tv/'
      },
      {
        name: 'Desenvolvido por fazercash | Prefixo: u.',
        type: 0
      }
    ],
    status: 'online'
  });
});

client.on(Events.GuildMemberAdd, async (member) => {
  const server = getServerConfig(member.guild.id);
  const auto = server.autoRole;

  if (!auto.enabled) return;

  const roleId = member.user.bot ? auto.botRoleId : auto.memberRoleId;
  if (roleId) {
    await member.roles.add(roleId).catch(() => {});
  }

  if (auto.boosterRoleId && member.premiumSince) {
    await member.roles.add(auto.boosterRoleId).catch(() => {});
  }
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const server = getServerConfig(newMember.guild.id);
  const auto = server.autoRole;

  if (!auto.enabled) return;

  if (!oldMember.premiumSince && newMember.premiumSince && auto.boosterRoleId) {
    await newMember.roles.add(auto.boosterRoleId).catch(() => {});
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  await handleAntiSpam(message);

  if (!message.guild) return;

  const ig = getInstagramConfig(message.guild.id);
  if (ig.postChannelId && message.channel.id === ig.postChannelId) {
    const attachment = message.attachments.first();
    if (!attachment) return;

    const storedUrl = await uploadToInstagramStorage(message.guild.id, attachment);
    if (!storedUrl) {
      await message.channel.send('❌ Configure o canal **IG Storage** no menu antes de postar.');
      return;
    }

    const caption = (message.content || '').trim() || null;

    const now = Date.now();
    const insert = igdb.prepare(`
      INSERT INTO instagram_posts (guild_id, channel_id, author_id, author_tag, author_avatar, media_url, caption, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insert.run(
      message.guild.id,
      message.channel.id,
      message.author.id,
      message.author.username,
      message.author.displayAvatarURL({ extension: 'png', size: 128 }),
      storedUrl,
      caption,
      now
    );

    const postId = result.lastInsertRowid;

    const hook = await getInstagramWebhook(message.channel).catch(() => null);
    if (!hook) return;

    const fileName = attachment.name || `instagram-${postId}.png`; 
    const response = await fetch(attachment.url);
    const buffer = Buffer.from(await response.arrayBuffer());
    const file = new AttachmentBuilder(buffer, { name: fileName });

    const container = buildInstagramPostContainer({
      authorTag: message.author.username,
      mediaUrl: `attachment://${fileName}`,
      likeCount: 0,
      commentCount: 0,
      emojis: ig.emojis,
      postId,
      caption
    });

    const sent = await hook.send({
      username: message.member?.displayName || message.author.username,
      avatarURL: message.author.displayAvatarURL({ extension: 'png', size: 128 }),
      files: [file],
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });

    const uploadedUrl = sent.attachments.first()?.url || storedUrl;

    igdb.prepare(`UPDATE instagram_posts SET message_id = ?, media_url = ? WHERE id = ?`)
      .run(sent.id, uploadedUrl, postId);

    igdb.prepare(`UPDATE instagram_posts SET message_id = ? WHERE id = ?`).run(sent.id, postId);
    await message.delete().catch(() => {});
    await updateHighlightIfNeeded(message.guild.id);
    return;
  }

  const pet = getInstaPetConfig(message.guild.id);
  if (pet.postChannelId && message.channel.id === pet.postChannelId) {
    const attachment = message.attachments.first();
    if (!attachment) return;

    const storedUrl = await uploadToInstaPetStorage(message.guild.id, attachment);
    if (!storedUrl) {
      await message.channel.send('❌ Configure o canal **Pet Storage** no menu antes de postar.');
      return;
    }

    const caption = (message.content || '').trim() || null;

    const now = Date.now();
    const insert = igdb.prepare(`
      INSERT INTO instapet_posts (guild_id, channel_id, author_id, author_tag, author_avatar, media_url, caption, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insert.run(
      message.guild.id,
      message.channel.id,
      message.author.id,
      message.author.username,
      message.author.displayAvatarURL({ extension: 'png', size: 128 }),
      storedUrl,
      caption,
      now
    );

    const postId = result.lastInsertRowid;

    const hook = await getInstaPetWebhook(message.channel).catch(() => null);
    if (!hook) return;

    const fileName = attachment.name || `instapet-${postId}.png`;
    const response = await fetch(attachment.url);
    const buffer = Buffer.from(await response.arrayBuffer());
    const file = new AttachmentBuilder(buffer, { name: fileName });

    const container = buildInstaPetPostContainer({
      authorTag: message.author.username,
      mediaUrl: `attachment://${fileName}`,
      likeCount: 0,
      commentCount: 0,
      emojis: pet.emojis,
      postId,
      caption
    });

    const sent = await hook.send({
      username: message.member?.displayName || message.author.username,
      avatarURL: message.author.displayAvatarURL({ extension: 'png', size: 128 }),
      files: [file],
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });

    const uploadedUrl = sent.attachments.first()?.url || storedUrl;

    igdb.prepare(`UPDATE instapet_posts SET message_id = ?, media_url = ? WHERE id = ?`)
      .run(sent.id, uploadedUrl, postId);

    await message.delete().catch(() => {});
    await updateInstaPetHighlightIfNeeded(message.guild.id);
    return;
  }

  if (!message.content.startsWith(getPrefix())) return;

  const guildConfig = getGuildConfig(message.guild.id);
  if (!isAuthorized(message.member, guildConfig)) return;

  const args = message.content.slice(getPrefix().length).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  if (command === 'menu') {
    const container = buildMainMenuContainer();
    await message.channel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });
    await message.delete().catch(() => {});
  }

  if (command === 'help') {
    const container = new ContainerBuilder()
      .addTextDisplayComponents(td => td.setContent(`📚 **Comandos:**\n\`${getPrefix()}menu\` - abre o menu`));
    await message.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (command === 'nuke') {
    const allowed = guildConfig.commands?.nuke?.allowedRoleIds || [];
    if (!isCommandRoleAllowed(message.member, allowed)) {
      const container = buildNoticeContainer('Sem permissão', [
        `👤 Autor: <@${message.author.id}>`,
        '❌ Você não tem permissão para usar este comando.'
      ]);
      return message.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const channel = message.channel;
    const parent = channel.parent;
    const perms = channel.permissionOverwrites.cache.map(overwrite => ({
      id: overwrite.id,
      allow: overwrite.allow.bitfield,
      deny: overwrite.deny.bitfield,
      type: overwrite.type
    }));

    const newChannel = await channel.clone({
      name: channel.name,
      type: channel.type,
      parent: parent?.id || null,
      permissionOverwrites: perms
    }).catch(() => null);

    if (!newChannel) {
      const fail = buildNoticeContainer('Erro', [
        '❌ Falha ao nukar o canal.'
      ]);
      return message.channel.send({ components: [fail], flags: MessageFlags.IsComponentsV2 });
    }

    await channel.delete().catch(() => {});

    const container = buildNoticeContainer('Canal Nukado', [
      `👤 Autor: <@${message.author.id}>`,
      `📝 Motivo: Nuke executado por ${message.author.username}`
    ]);

    return newChannel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
  }

  if (command === 'clear') {
    const allowed = guildConfig.commands?.clear?.allowedRoleIds || [];
    if (!isCommandRoleAllowed(message.member, allowed)) {
      const container = buildNoticeContainer('Sem permissão', [
        `👤 Autor: <@${message.author.id}>`,
        '❌ Você não tem permissão para usar este comando.'
      ]);
      return message.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const amount = parseInt(args[0]);
    if (!amount || isNaN(amount) || amount < 1 || amount > 100) {
      const container = buildNoticeContainer('Uso incorreto', [
        `👤 Autor: <@${message.author.id}>`,
        '❗ Use: u.clear <1-100>'
      ]);
      return message.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    await message.channel.bulkDelete(amount, true).catch(() => {});
    const done = buildNoticeContainer('Mensagens apagadas', [
      `👤 Autor: <@${message.author.id}>`,
      `🧹 Quantidade: ${amount}`
    ]);
    return message.channel.send({ components: [done], flags: MessageFlags.IsComponentsV2 });
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  const guildId = interaction.guildId;
  const guildConfig = guildId ? getGuildConfig(guildId) : null;

  const isInstagramPublic =
    (interaction.isButton() && interaction.customId.startsWith('ig_')) ||
    (interaction.isStringSelectMenu() && interaction.customId.startsWith('ig_')) ||
    (interaction.isModalSubmit() && interaction.customId.startsWith('modal_ig_comment_'));

  const isInstagramDelete =
    interaction.isButton() && interaction.customId.startsWith('ig_delete_');

  if (guildConfig && !isAuthorized(interaction.member, guildConfig)) {
    if (isInstagramPublic && !isInstagramDelete) {
      // público: pode curtir, comentar e ver info
    } else {
      return interaction.reply({ content: '❌ Você não tem permissão.', ephemeral: true });
    }
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'main_menu') {
    const choice = interaction.values[0];

    if (choice === 'close') {
      await interaction.deferUpdate();
      return interaction.message.delete().catch(() => {});
    }

    if (choice === 'utilities') {
      const container = buildUtilitiesMenuContainer();
      await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
      await interaction.deferUpdate();
      return interaction.message.delete().catch(() => {});
    }

    if (choice === 'appearance') {
      const container = buildAppearanceContainer();
      await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
    }

    if (choice === 'commands') {
      const container = buildCommandsContainer(interaction.guildId);
      const sent = await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });

      commandPanels.set(interaction.guildId, {
        channelId: interaction.channelId,
        messageId: sent.id
      });
    }

    if (choice === 'instagram') {
      const container = buildInstagramMenuContainer();
      await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
    }

    if (choice === 'server') {
      const container = buildServerMenuContainer();
      await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
      await interaction.deferUpdate();
      return interaction.message.delete().catch(() => {});
    }

    if (choice === 'entertainment') {
      const container = buildEntertainmentMenuContainer();
      await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
      await interaction.deferUpdate();
      return interaction.message.delete().catch(() => {});
    }

    if (choice === 'security') {
      const container = buildSecurityMenuContainer();
      await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
      await interaction.deferUpdate();
      return interaction.message.delete().catch(() => {});
    }

    if (choice === 'antispam') {
      const container = buildAntiSpamContainer(interaction.guildId);
      await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
    }

    if (choice === 'permissions') {
      const addButton = new ButtonBuilder()
        .setCustomId('perm_add_user')
        .setLabel('Autorizar Membro')
        .setStyle(ButtonStyle.Success);

      const removeButton = new ButtonBuilder()
        .setCustomId('perm_remove_user')
        .setLabel('Remover Membro')
        .setStyle(ButtonStyle.Danger);

      const closeButton = new ButtonBuilder()
        .setCustomId('perm_close')
        .setLabel('Fechar')
        .setStyle(ButtonStyle.Secondary);

      const container = new ContainerBuilder()
        .addTextDisplayComponents(td =>
          td.setContent(`# 🔐 Permissões\nUse os botões para autorizar ou remover por ID.`)
        )
        .addActionRowComponents(new ActionRowBuilder().addComponents(addButton, removeButton))
        .addActionRowComponents(new ActionRowBuilder().addComponents(closeButton));

      await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
    }

    return interaction.update({
      components: [buildMainMenuContainer()],
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'entertainment_menu') {
    const choice = interaction.values[0];

    if (choice === 'close') {
      await interaction.deferUpdate();
      return interaction.message.delete().catch(() => {});
    }

    if (choice === 'home') {
      await interaction.deferUpdate();
      await interaction.message.delete().catch(() => {});

      const container = buildMainMenuContainer();
      await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
      return;
    }

    if (choice === 'instagram') {
      await interaction.deferUpdate();
      await interaction.message.delete().catch(() => {});

      const container = buildInstagramMenuContainer();
      await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
      return;
    }

    if (choice === 'instapet') {
      await interaction.deferUpdate();
      await interaction.message.delete().catch(() => {});

      const container = buildInstaPetMenuContainer();
      await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
      return;
    }

    return interaction.update({
      components: [buildEntertainmentMenuContainer()],
      flags: MessageFlags.IsComponentsV2
    });
  }

  // --- Insta Pet handlers ---
  if (interaction.isButton() && interaction.customId === 'pet_close') {
    await interaction.deferUpdate();
    return interaction.message.delete().catch(() => {});
  }

  if (interaction.isButton() && interaction.customId === 'pet_config') {
    const container = buildInstaPetConfigContainer(interaction.guildId);
    await interaction.channel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });
    return interaction.deferUpdate();
  }

  if (interaction.isButton() && interaction.customId === 'pet_emojis') {
    const modal = new ModalBuilder()
      .setCustomId('modal_pet_emojis')
      .setTitle('Configurar Emojis (Insta Pet)');

    const like = new TextInputBuilder().setCustomId('emoji_like').setLabel('Emoji Curtida').setStyle(TextInputStyle.Short).setRequired(true);
    const comment = new TextInputBuilder().setCustomId('emoji_comment').setLabel('Emoji Comentário').setStyle(TextInputStyle.Short).setRequired(true);
    const info = new TextInputBuilder().setCustomId('emoji_info').setLabel('Emoji Info').setStyle(TextInputStyle.Short).setRequired(true);
    const del = new TextInputBuilder().setCustomId('emoji_delete').setLabel('Emoji Lixeira').setStyle(TextInputStyle.Short).setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(like),
      new ActionRowBuilder().addComponents(comment),
      new ActionRowBuilder().addComponents(info),
      new ActionRowBuilder().addComponents(del)
    );

    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_pet_emojis') {
    const pet = getInstaPetConfig(interaction.guildId);

    pet.emojis.like = interaction.fields.getTextInputValue('emoji_like').trim() || '❤️';
    pet.emojis.comment = interaction.fields.getTextInputValue('emoji_comment').trim() || '💬';
    pet.emojis.info = interaction.fields.getTextInputValue('emoji_info').trim() || 'ℹ️';
    pet.emojis.delete = interaction.fields.getTextInputValue('emoji_delete').trim() || '🗑️';

    saveConfig();
    return interaction.reply({ content: '✅ Emojis do Insta Pet atualizados!', ephemeral: true });
  }

  if (interaction.isChannelSelectMenu() && interaction.customId === 'pet_post_channel') {
    const pet = getInstaPetConfig(interaction.guildId);
    pet.postChannelId = interaction.values[0];
    saveConfig();
    await interaction.deferUpdate();
    return interaction.message.edit({
      components: [buildInstaPetConfigContainer(interaction.guildId)],
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (interaction.isChannelSelectMenu() && interaction.customId === 'pet_highlight_channel') {
    const pet = getInstaPetConfig(interaction.guildId);
    pet.highlightChannelId = interaction.values[0];
    saveConfig();
    await interaction.deferUpdate();
    return interaction.message.edit({
      components: [buildInstaPetConfigContainer(interaction.guildId)],
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (interaction.isChannelSelectMenu() && interaction.customId === 'pet_storage_channel') {
    const pet = getInstaPetConfig(interaction.guildId);
    pet.storageChannelId = interaction.values[0];
    saveConfig();
    await interaction.deferUpdate();
    return interaction.message.edit({
      components: [buildInstaPetConfigContainer(interaction.guildId)],
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (interaction.isRoleSelectMenu() && interaction.customId === 'pet_highlight_role') {
    const pet = getInstaPetConfig(interaction.guildId);
    pet.highlightRoleId = interaction.values[0];
    saveConfig();
    await interaction.deferUpdate();
    return interaction.message.edit({
      components: [buildInstaPetConfigContainer(interaction.guildId)],
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'pet_clear_highlight') {
    const pet = getInstaPetConfig(interaction.guildId);
    pet.clearHighlightEnabled = interaction.values[0] === 'on';
    saveConfig();
    await interaction.deferUpdate();
    return interaction.message.edit({
      components: [buildInstaPetConfigContainer(interaction.guildId)],
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'security_menu') {
    const choice = interaction.values[0];

    if (choice === 'close') {
      await interaction.deferUpdate();
      return interaction.message.delete().catch(() => {});
    }

    if (choice === 'home') {
      await interaction.deferUpdate();
      await interaction.message.delete().catch(() => {});

      const container = buildMainMenuContainer();
      await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
      return;
    }

    if (choice === 'antispam') {
      await interaction.deferUpdate();
      await interaction.message.delete().catch(() => {});

      const container = buildAntiSpamContainer(interaction.guildId);
      await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
      return;
    }

    return interaction.update({
      components: [buildSecurityMenuContainer()],
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'utilities_menu') {
    const choice = interaction.values[0];

    if (choice === 'close') {
      await interaction.deferUpdate();
      return interaction.message.delete().catch(() => {});
    }

    if (choice === 'home') {
      await interaction.deferUpdate();
      await interaction.message.delete().catch(() => {});

      const container = buildMainMenuContainer();
      await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
      return;
    }

    if (choice === 'embed') {
      await interaction.deferUpdate();
      await interaction.message.delete().catch(() => {});

      const sessionId = createSession(interaction.user.id, interaction.channelId);
      const session = getSessionById(sessionId);

      const container = buildBuilderContainer(session);
      const sent = await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });

      session.builderMessageId = sent.id;
      setTimeout(() => sessions.delete(sessionId), 30 * 60 * 1000);
      return;
    }

    if (choice === 'embed_save') {
      await interaction.deferUpdate();
      await interaction.message.delete().catch(() => {});

      const container = buildSavedManagerContainer();
      await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
      return;
    }

    return interaction.update({
      components: [buildUtilitiesMenuContainer()],
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'server_menu') {
    const choice = interaction.values[0];

    if (choice === 'close') {
      await interaction.deferUpdate();
      return interaction.message.delete().catch(() => {});
    }

    if (choice === 'home') {
      await interaction.deferUpdate();
      await interaction.message.delete().catch(() => {});

      const container = buildMainMenuContainer();
      await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
      return;
    }

    if (choice === 'logs') {
      const container = buildServerLogsContainer(interaction.guildId);
      const sent = await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });

      logsPanels.set(interaction.guildId, {
        channelId: interaction.channelId,
        messageId: sent.id
      });

      await interaction.deferUpdate();
      return interaction.message.delete().catch(() => {});
    }

    if (choice === 'autorole') {
      const container = buildAutoRoleContainer(interaction.guildId);
      const sent = await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });

      autoRolePanels.set(interaction.guildId, {
        channelId: interaction.channelId,
        messageId: sent.id
      });

      await interaction.deferUpdate();
      return interaction.message.delete().catch(() => {});
    }

    return interaction.update({
      components: [buildServerMenuContainer()],
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (interaction.isButton() && interaction.customId === 'logs_back') {
    logsPanels.delete(interaction.guildId);
    const container = buildServerMenuContainer();
    await interaction.channel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });
    await interaction.deferUpdate();
    return interaction.message.delete().catch(() => {});
  }

  if (interaction.isButton() && interaction.customId === 'autorole_back') {
    autoRolePanels.delete(interaction.guildId);
    const container = buildServerMenuContainer();
    await interaction.channel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });
    await interaction.deferUpdate();
    return interaction.message.delete().catch(() => {});
  }

  if (interaction.isButton() && interaction.customId === 'autorole_toggle') {
    const server = getServerConfig(interaction.guildId);
    server.autoRole.enabled = !server.autoRole.enabled;
    saveConfig();
    await updateAutoRolePanel(interaction.guildId);
    return interaction.deferUpdate();
  }

  if (interaction.isButton() && interaction.customId === 'autorole_set_member') {
    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId('autorole_select_member')
      .setPlaceholder('Selecionar cargo de membro')
      .setMaxValues(1);

    return interaction.reply({
      ephemeral: true,
      components: [new ActionRowBuilder().addComponents(roleSelect)]
    });
  }

  if (interaction.isButton() && interaction.customId === 'autorole_set_bot') {
    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId('autorole_select_bot')
      .setPlaceholder('Selecionar cargo de bot')
      .setMaxValues(1);

    return interaction.reply({
      ephemeral: true,
      components: [new ActionRowBuilder().addComponents(roleSelect)]
    });
  }

  if (interaction.isButton() && interaction.customId === 'autorole_set_booster') {
    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId('autorole_select_booster')
      .setPlaceholder('Selecionar cargo de booster')
      .setMaxValues(1);

    return interaction.reply({
      ephemeral: true,
      components: [new ActionRowBuilder().addComponents(roleSelect)]
    });
  }

  if (interaction.isRoleSelectMenu() && interaction.customId === 'autorole_select_member') {
    const server = getServerConfig(interaction.guildId);
    server.autoRole.memberRoleId = interaction.values[0];
    saveConfig();
    await updateAutoRolePanel(interaction.guildId);
    return interaction.update({ content: '✅ Cargo de membro definido!', components: [] });
  }

  if (interaction.isRoleSelectMenu() && interaction.customId === 'autorole_select_bot') {
    const server = getServerConfig(interaction.guildId);
    server.autoRole.botRoleId = interaction.values[0];
    saveConfig();
    await updateAutoRolePanel(interaction.guildId);
    return interaction.update({ content: '✅ Cargo de bot definido!', components: [] });
  }

  if (interaction.isRoleSelectMenu() && interaction.customId === 'autorole_select_booster') {
    const server = getServerConfig(interaction.guildId);
    server.autoRole.boosterRoleId = interaction.values[0];
    saveConfig();
    await updateAutoRolePanel(interaction.guildId);
    return interaction.update({ content: '✅ Cargo de booster definido!', components: [] });
  }

  if (interaction.isButton() && interaction.customId === 'logs_bans') {
    const modal = new ModalBuilder()
      .setCustomId('modal_logs_bans')
      .setTitle('Banimentos e expulsões');

    const ban = new TextInputBuilder().setCustomId('log_ban').setLabel('Banimentos (ID canal ou webhook)').setStyle(TextInputStyle.Short).setRequired(false);
    const unban = new TextInputBuilder().setCustomId('log_unban').setLabel('Desbanimentos (ID canal ou webhook)').setStyle(TextInputStyle.Short).setRequired(false);
    const kick = new TextInputBuilder().setCustomId('log_kick').setLabel('Expulsões (ID canal ou webhook)').setStyle(TextInputStyle.Short).setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(ban),
      new ActionRowBuilder().addComponents(unban),
      new ActionRowBuilder().addComponents(kick)
    );

    return interaction.showModal(modal);
  }

  if (interaction.isButton() && interaction.customId === 'logs_roles') {
    const modal = new ModalBuilder()
      .setCustomId('modal_logs_roles')
      .setTitle('Cargos');

    const create = new TextInputBuilder().setCustomId('log_role_create').setLabel('Criar cargos (ID canal ou webhook)').setStyle(TextInputStyle.Short).setRequired(false);
    const del = new TextInputBuilder().setCustomId('log_role_delete').setLabel('Deletar cargos (ID canal ou webhook)').setStyle(TextInputStyle.Short).setRequired(false);
    const update = new TextInputBuilder().setCustomId('log_role_update').setLabel('Editar cargos (ID canal ou webhook)').setStyle(TextInputStyle.Short).setRequired(false);
    const add = new TextInputBuilder().setCustomId('log_role_add').setLabel('Adicionar cargos (ID canal ou webhook)').setStyle(TextInputStyle.Short).setRequired(false);
    const remove = new TextInputBuilder().setCustomId('log_role_remove').setLabel('Remover cargos (ID canal ou webhook)').setStyle(TextInputStyle.Short).setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(create),
      new ActionRowBuilder().addComponents(del),
      new ActionRowBuilder().addComponents(update),
      new ActionRowBuilder().addComponents(add),
      new ActionRowBuilder().addComponents(remove)
    );

    return interaction.showModal(modal);
  }

  if (interaction.isButton() && interaction.customId === 'logs_channels') {
    const modal = new ModalBuilder()
      .setCustomId('modal_logs_channels')
      .setTitle('Canais');

    const create = new TextInputBuilder().setCustomId('log_channel_create').setLabel('Criar canais (ID canal ou webhook)').setStyle(TextInputStyle.Short).setRequired(false);
    const del = new TextInputBuilder().setCustomId('log_channel_delete').setLabel('Deletar canais (ID canal ou webhook)').setStyle(TextInputStyle.Short).setRequired(false);
    const update = new TextInputBuilder().setCustomId('log_channel_update').setLabel('Atualizar canais (ID canal ou webhook)').setStyle(TextInputStyle.Short).setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(create),
      new ActionRowBuilder().addComponents(del),
      new ActionRowBuilder().addComponents(update)
    );

    return interaction.showModal(modal);
  }

  if (interaction.isButton() && interaction.customId === 'logs_mutes') {
    const modal = new ModalBuilder()
      .setCustomId('modal_logs_mutes')
      .setTitle('Membros silenciados');

    const chat = new TextInputBuilder().setCustomId('log_mute_chat').setLabel('Silenciados chat (ID canal ou webhook)').setStyle(TextInputStyle.Short).setRequired(false);
    const voice = new TextInputBuilder().setCustomId('log_mute_voice').setLabel('Silenciados voz (ID canal ou webhook)').setStyle(TextInputStyle.Short).setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(chat),
      new ActionRowBuilder().addComponents(voice)
    );

    return interaction.showModal(modal);
  }

  if (interaction.isButton() && interaction.customId === 'logs_bots') {
    const modal = new ModalBuilder()
      .setCustomId('modal_logs_bots')
      .setTitle('Bots adicionados');

    const bots = new TextInputBuilder().setCustomId('log_bots_add').setLabel('Bots adicionados (ID canal ou webhook)').setStyle(TextInputStyle.Short).setRequired(false);

    modal.addComponents(new ActionRowBuilder().addComponents(bots));
    return interaction.showModal(modal);
  }

  if (interaction.isButton() && interaction.customId === 'logs_joins') {
    const modal = new ModalBuilder()
      .setCustomId('modal_logs_joins')
      .setTitle('Entrada e saída');

    const join = new TextInputBuilder().setCustomId('log_join').setLabel('Entrada de membros (ID canal ou webhook)').setStyle(TextInputStyle.Short).setRequired(false);
    const leave = new TextInputBuilder().setCustomId('log_leave').setLabel('Saída de membros (ID canal ou webhook)').setStyle(TextInputStyle.Short).setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(join),
      new ActionRowBuilder().addComponents(leave)
    );

    return interaction.showModal(modal);
  }

  if (interaction.isButton() && interaction.customId === 'logs_messages') {
    const modal = new ModalBuilder()
      .setCustomId('modal_logs_messages')
      .setTitle('Mensagens');

    const del = new TextInputBuilder().setCustomId('log_msg_delete').setLabel('Mensagens apagadas (ID canal ou webhook)').setStyle(TextInputStyle.Short).setRequired(false);
    const update = new TextInputBuilder().setCustomId('log_msg_update').setLabel('Mensagens atualizadas (ID canal ou webhook)').setStyle(TextInputStyle.Short).setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(del),
      new ActionRowBuilder().addComponents(update)
    );

    return interaction.showModal(modal);
  }

  if (interaction.isButton() && interaction.customId === 'logs_voice') {
    const modal = new ModalBuilder()
      .setCustomId('modal_logs_voice')
      .setTitle('Tráfego de voz');

    const voice = new TextInputBuilder().setCustomId('log_voice').setLabel('Tráfego de voz (ID canal ou webhook)').setStyle(TextInputStyle.Short).setRequired(false);

    modal.addComponents(new ActionRowBuilder().addComponents(voice));
    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_logs_bans') {
    const server = getServerConfig(interaction.guildId);
    server.logs.bans.ban = parseLogTarget(interaction.fields.getTextInputValue('log_ban'));
    server.logs.bans.unban = parseLogTarget(interaction.fields.getTextInputValue('log_unban'));
    server.logs.bans.kick = parseLogTarget(interaction.fields.getTextInputValue('log_kick'));
    saveConfig();
    await updateLogsPanel(interaction.guildId);
    return interaction.reply({ content: '✅ Logs de banimentos salvos!', ephemeral: true });
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_logs_roles') {
    const server = getServerConfig(interaction.guildId);
    server.logs.roles.create = parseLogTarget(interaction.fields.getTextInputValue('log_role_create'));
    server.logs.roles.delete = parseLogTarget(interaction.fields.getTextInputValue('log_role_delete'));
    server.logs.roles.update = parseLogTarget(interaction.fields.getTextInputValue('log_role_update'));
    server.logs.roles.add = parseLogTarget(interaction.fields.getTextInputValue('log_role_add'));
    server.logs.roles.remove = parseLogTarget(interaction.fields.getTextInputValue('log_role_remove'));
    saveConfig();
    await updateLogsPanel(interaction.guildId);
    return interaction.reply({ content: '✅ Logs de cargos salvos!', ephemeral: true });
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_logs_channels') {
    const server = getServerConfig(interaction.guildId);
    server.logs.channels.create = parseLogTarget(interaction.fields.getTextInputValue('log_channel_create'));
    server.logs.channels.delete = parseLogTarget(interaction.fields.getTextInputValue('log_channel_delete'));
    server.logs.channels.update = parseLogTarget(interaction.fields.getTextInputValue('log_channel_update'));
    saveConfig();
    await updateLogsPanel(interaction.guildId);
    return interaction.reply({ content: '✅ Logs de canais salvos!', ephemeral: true });
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_logs_mutes') {
    const server = getServerConfig(interaction.guildId);
    server.logs.mutes.chat = parseLogTarget(interaction.fields.getTextInputValue('log_mute_chat'));
    server.logs.mutes.voice = parseLogTarget(interaction.fields.getTextInputValue('log_mute_voice'));
    saveConfig();
    await updateLogsPanel(interaction.guildId);
    return interaction.reply({ content: '✅ Logs de silenciados salvos!', ephemeral: true });
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_logs_bots') {
    const server = getServerConfig(interaction.guildId);
    server.logs.bots.add = parseLogTarget(interaction.fields.getTextInputValue('log_bots_add'));
    saveConfig();
    await updateLogsPanel(interaction.guildId);
    return interaction.reply({ content: '✅ Logs de bots salvos!', ephemeral: true });
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_logs_joins') {
    const server = getServerConfig(interaction.guildId);
    server.logs.joins.join = parseLogTarget(interaction.fields.getTextInputValue('log_join'));
    server.logs.joins.leave = parseLogTarget(interaction.fields.getTextInputValue('log_leave'));
    saveConfig();
    await updateLogsPanel(interaction.guildId);
    return interaction.reply({ content: '✅ Logs de entrada/saída salvos!', ephemeral: true });
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_logs_messages') {
    const server = getServerConfig(interaction.guildId);
    server.logs.messages.delete = parseLogTarget(interaction.fields.getTextInputValue('log_msg_delete'));
    server.logs.messages.update = parseLogTarget(interaction.fields.getTextInputValue('log_msg_update'));
    saveConfig();
    await updateLogsPanel(interaction.guildId);
    return interaction.reply({ content: '✅ Logs de mensagens salvos!', ephemeral: true });
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_logs_voice') {
    const server = getServerConfig(interaction.guildId);
    server.logs.voice.traffic = parseLogTarget(interaction.fields.getTextInputValue('log_voice'));
    saveConfig();
    await updateLogsPanel(interaction.guildId);
    return interaction.reply({ content: '✅ Logs de voz salvos!', ephemeral: true });
  }

  if (interaction.isButton() && interaction.customId === 'ig_close') {
    await interaction.deferUpdate();
    return interaction.message.delete().catch(() => {});
  }

  if (interaction.isButton() && interaction.customId === 'ig_config') {
    const container = buildInstagramConfigContainer(interaction.guildId);
    await interaction.channel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });
    return interaction.deferUpdate();
  }

  if (interaction.isButton() && interaction.customId === 'ig_emojis') {
    const modal = new ModalBuilder()
      .setCustomId('modal_ig_emojis')
      .setTitle('Configurar Emojis');

    const like = new TextInputBuilder().setCustomId('emoji_like').setLabel('Emoji Curtida').setStyle(TextInputStyle.Short).setRequired(true);
    const comment = new TextInputBuilder().setCustomId('emoji_comment').setLabel('Emoji Comentário').setStyle(TextInputStyle.Short).setRequired(true);
    const info = new TextInputBuilder().setCustomId('emoji_info').setLabel('Emoji Info').setStyle(TextInputStyle.Short).setRequired(true);
    const del = new TextInputBuilder().setCustomId('emoji_delete').setLabel('Emoji Lixeira').setStyle(TextInputStyle.Short).setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(like),
      new ActionRowBuilder().addComponents(comment),
      new ActionRowBuilder().addComponents(info),
      new ActionRowBuilder().addComponents(del)
    );

    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_ig_emojis') {
    const ig = getInstagramConfig(interaction.guildId);

    const like = interaction.fields.getTextInputValue('emoji_like').trim();
    const comment = interaction.fields.getTextInputValue('emoji_comment').trim();
    const info = interaction.fields.getTextInputValue('emoji_info').trim();
    const del = interaction.fields.getTextInputValue('emoji_delete').trim();

    ig.emojis.like = like || '❤️';
    ig.emojis.comment = comment || '💬';
    ig.emojis.info = info || 'ℹ️';
    ig.emojis.delete = del || '🗑️';

    saveConfig();
    return interaction.reply({ content: '✅ Emojis atualizados!', ephemeral: true });
  }

  if (interaction.isChannelSelectMenu() && interaction.customId === 'ig_post_channel') {
    const ig = getInstagramConfig(interaction.guildId);
    ig.postChannelId = interaction.values[0];
    saveConfig();
    await interaction.deferUpdate();
    return interaction.message.edit({
      components: [buildInstagramConfigContainer(interaction.guildId)],
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (interaction.isChannelSelectMenu() && interaction.customId === 'ig_highlight_channel') {
    const ig = getInstagramConfig(interaction.guildId);
    ig.highlightChannelId = interaction.values[0];
    saveConfig();
    await interaction.deferUpdate();
    return interaction.message.edit({
      components: [buildInstagramConfigContainer(interaction.guildId)],
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (interaction.isChannelSelectMenu() && interaction.customId === 'ig_storage_channel') {
    const ig = getInstagramConfig(interaction.guildId);
    ig.storageChannelId = interaction.values[0];
    saveConfig();
    await interaction.deferUpdate();
    return interaction.message.edit({
      components: [buildInstagramConfigContainer(interaction.guildId)],
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (interaction.isRoleSelectMenu() && interaction.customId === 'ig_highlight_role') {
    const ig = getInstagramConfig(interaction.guildId);
    ig.highlightRoleId = interaction.values[0];
    saveConfig();
    await interaction.deferUpdate();
    return interaction.message.edit({
      components: [buildInstagramConfigContainer(interaction.guildId)],
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'ig_clear_highlight') {
    const ig = getInstagramConfig(interaction.guildId);
    ig.clearHighlightEnabled = interaction.values[0] === 'on';
    saveConfig();
    await interaction.deferUpdate();
    return interaction.message.edit({
      components: [buildInstagramConfigContainer(interaction.guildId)],
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (interaction.isButton() && interaction.customId.startsWith('ig_like_')) {
    const postId = Number(interaction.customId.replace('ig_like_', ''));
    const liked = igdb.prepare('SELECT 1 FROM instagram_likes WHERE post_id = ? AND user_id = ?').get(postId, interaction.user.id);

    if (liked) {
      igdb.prepare('DELETE FROM instagram_likes WHERE post_id = ? AND user_id = ?').run(postId, interaction.user.id);
    } else {
      igdb.prepare('INSERT OR IGNORE INTO instagram_likes (post_id, user_id, created_at) VALUES (?, ?, ?)').run(postId, interaction.user.id, Date.now());
    }

    const stats = getInstagramStats(postId);
    console.log('[IG LIKE]', { postId, stats });

    const post = igdb.prepare('SELECT * FROM instagram_posts WHERE id = ?').get(postId);
    if (post) {
      await updateInstagramMessage(post.guild_id, post.channel_id, post.message_id, postId);
      await updateHighlightIfNeeded(post.guild_id);
    }

    return interaction.deferUpdate();
  }

  if (interaction.isButton() && interaction.customId.startsWith('ig_comment_')) {
    const postId = interaction.customId.replace('ig_comment_', '');
    const modal = new ModalBuilder()
      .setCustomId(`modal_ig_comment_${postId}`)
      .setTitle('Comentar');

    const input = new TextInputBuilder()
      .setCustomId('comment_text')
      .setLabel('Seu comentário')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(300);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_ig_comment_')) {
    const postId = Number(interaction.customId.replace('modal_ig_comment_', ''));
    const content = interaction.fields.getTextInputValue('comment_text').trim();

    igdb.prepare(`
      INSERT INTO instagram_comments (post_id, user_id, user_tag, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(postId, interaction.user.id, interaction.user.username, content, Date.now());

    const post = igdb.prepare('SELECT * FROM instagram_posts WHERE id = ?').get(postId);
    if (post) {
      await updateInstagramMessage(post.guild_id, post.channel_id, post.message_id, postId);
    }

    return interaction.reply({ content: '✅ Comentário enviado!', ephemeral: true });
  }

  if (interaction.isButton() && interaction.customId.startsWith('ig_info_')) {
    const postId = Number(interaction.customId.replace('ig_info_', ''));
    const likes = igdb.prepare('SELECT user_id FROM instagram_likes WHERE post_id = ? LIMIT 20').all(postId);
    const comments = igdb.prepare('SELECT user_tag, content FROM instagram_comments WHERE post_id = ? ORDER BY id DESC LIMIT 5').all(postId);

    const likeList = likes.length ? likes.map(l => `<@${l.user_id}>`).join(', ') : '—';
    const commentList = comments.length ? comments.map(c => `• **${c.user_tag}**: ${c.content}`).join('\n') : '—';

    return interaction.reply({
      ephemeral: true,
      components: [new ContainerBuilder().addTextDisplayComponents(td =>
        td.setContent(
          `# ℹ️ Info da Postagem\n` +
          `**Curtidas:** ${likeList}\n\n` +
          `**Últimos comentários:**\n${commentList}`
        )
      )],
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (interaction.isButton() && interaction.customId.startsWith('ig_delete_')) {
    const postId = Number(interaction.customId.replace('ig_delete_', ''));
    const post = igdb.prepare('SELECT * FROM instagram_posts WHERE id = ?').get(postId);
    if (!post) return interaction.reply({ content: '❌ Post não encontrado.', ephemeral: true });

    if (post.author_id !== interaction.user.id) {
      return interaction.reply({ content: '❌ Só o autor pode apagar.', ephemeral: true });
    }

    await interaction.message.delete().catch(() => {});
    igdb.prepare('DELETE FROM instagram_posts WHERE id = ?').run(postId);
    igdb.prepare('DELETE FROM instagram_likes WHERE post_id = ?').run(postId);
    igdb.prepare('DELETE FROM instagram_comments WHERE post_id = ?').run(postId);

    await updateHighlightIfNeeded(post.guild_id);
    return interaction.reply({ content: '✅ Post apagado.', ephemeral: true });
  }

  if (interaction.isButton() && interaction.customId === 'cmd_close') {
    const panel = commandPanels.get(interaction.guildId);
    if (panel && panel.messageId === interaction.message.id) {
      commandPanels.delete(interaction.guildId);
    }

    await interaction.deferUpdate();
    return interaction.message.delete().catch(() => {});
  }

  if (interaction.isButton() && interaction.customId === 'cmd_perm_nuke') {
    const cfg = getGuildConfig(interaction.guildId);
    commandPermissionDrafts.set(interaction.user.id, {
      command: 'nuke',
      guildId: interaction.guildId,
      allowedRoleIds: cfg.commands.nuke.allowedRoleIds || []
    });

    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId('cmd_roles_nuke')
      .setPlaceholder('Selecionar cargos autorizados')
      .setMaxValues(25);

    const saveButton = new ButtonBuilder()
      .setCustomId('cmd_save_nuke')
      .setLabel('Salvar')
      .setStyle(ButtonStyle.Success);

    const closeButton = new ButtonBuilder()
      .setCustomId('cmd_close')
      .setLabel('Fechar')
      .setStyle(ButtonStyle.Danger);

    const container = new ContainerBuilder()
      .addTextDisplayComponents(td =>
        td.setContent(`# 🧨 Permissões u.nuke\nSelecione os cargos autorizados.`)
      )
      .addActionRowComponents(new ActionRowBuilder().addComponents(roleSelect))
      .addActionRowComponents(new ActionRowBuilder().addComponents(saveButton, closeButton));

    await interaction.channel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });
    return interaction.deferUpdate();
  }

  if (interaction.isButton() && interaction.customId === 'cmd_perm_clear') {
    const cfg = getGuildConfig(interaction.guildId);
    commandPermissionDrafts.set(interaction.user.id, {
      command: 'clear',
      guildId: interaction.guildId,
      allowedRoleIds: cfg.commands.clear.allowedRoleIds || []
    });

    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId('cmd_roles_clear')
      .setPlaceholder('Selecionar cargos autorizados')
      .setMaxValues(25);

    const saveButton = new ButtonBuilder()
      .setCustomId('cmd_save_clear')
      .setLabel('Salvar')
      .setStyle(ButtonStyle.Success);

    const closeButton = new ButtonBuilder()
      .setCustomId('cmd_close')
      .setLabel('Fechar')
      .setStyle(ButtonStyle.Danger);

    const container = new ContainerBuilder()
      .addTextDisplayComponents(td =>
        td.setContent(`# 🧹 Permissões u.clear\nSelecione os cargos autorizados.`)
      )
      .addActionRowComponents(new ActionRowBuilder().addComponents(roleSelect))
      .addActionRowComponents(new ActionRowBuilder().addComponents(saveButton, closeButton));

    await interaction.channel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });
    return interaction.deferUpdate();
  }

  if (interaction.isRoleSelectMenu() && interaction.customId === 'cmd_roles_nuke') {
    const draft = commandPermissionDrafts.get(interaction.user.id);
    if (!draft || draft.command !== 'nuke') {
      return interaction.reply({ content: '❌ Sessão inválida.', ephemeral: true });
    }
    draft.allowedRoleIds = interaction.values;
    return interaction.update({
      components: interaction.message.components,
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (interaction.isRoleSelectMenu() && interaction.customId === 'cmd_roles_clear') {
    const draft = commandPermissionDrafts.get(interaction.user.id);
    if (!draft || draft.command !== 'clear') {
      return interaction.reply({ content: '❌ Sessão inválida.', ephemeral: true });
    }
    draft.allowedRoleIds = interaction.values;
    return interaction.update({
      components: interaction.message.components,
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (interaction.isButton() && interaction.customId === 'cmd_save_nuke') {
    const draft = commandPermissionDrafts.get(interaction.user.id);
    if (!draft || draft.command !== 'nuke') {
      return interaction.reply({ content: '❌ Sessão inválida.', ephemeral: true });
    }

    const cfg = getGuildConfig(draft.guildId);
    cfg.commands.nuke.allowedRoleIds = draft.allowedRoleIds || [];
    saveConfig();

    commandPermissionDrafts.delete(interaction.user.id);
    await updateCommandsPanel(draft.guildId);

    return interaction.reply({ content: '✅ Permissões do u.nuke salvas!', ephemeral: true });
  }

  if (interaction.isButton() && interaction.customId === 'cmd_save_clear') {
    const draft = commandPermissionDrafts.get(interaction.user.id);
    if (!draft || draft.command !== 'clear') {
      return interaction.reply({ content: '❌ Sessão inválida.', ephemeral: true });
    }

    const cfg = getGuildConfig(draft.guildId);
    cfg.commands.clear.allowedRoleIds = draft.allowedRoleIds || [];
    saveConfig();

    commandPermissionDrafts.delete(interaction.user.id);
    await updateCommandsPanel(draft.guildId);

    return interaction.reply({ content: '✅ Permissões do u.clear salvas!', ephemeral: true });
  }

  if (interaction.isButton() && interaction.customId === 'appearance_close') {
    await interaction.deferUpdate();
    return interaction.message.delete().catch(() => {});
  }

  if (interaction.isButton() && interaction.customId === 'appearance_username') {
    const modal = new ModalBuilder()
      .setCustomId('modal_appearance_username')
      .setTitle('Alterar Username');

    const input = new TextInputBuilder()
      .setCustomId('appearance_username')
      .setLabel('Novo username')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(32);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  if (interaction.isButton() && interaction.customId === 'appearance_avatar') {
    const modal = new ModalBuilder()
      .setCustomId('modal_appearance_avatar')
      .setTitle('Alterar Avatar');

    const input = new TextInputBuilder()
      .setCustomId('appearance_avatar')
      .setLabel('URL do avatar (vazio remove)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  if (interaction.isButton() && interaction.customId === 'appearance_banner') {
    const modal = new ModalBuilder()
      .setCustomId('modal_appearance_banner')
      .setTitle('Alterar Banner');

    const input = new TextInputBuilder()
      .setCustomId('appearance_banner')
      .setLabel('URL do banner (vazio remove)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  if (interaction.isButton() && interaction.customId === 'appearance_prefix') {
    const modal = new ModalBuilder()
      .setCustomId('modal_appearance_prefix')
      .setTitle('Alterar Prefixo');

    const input = new TextInputBuilder()
      .setCustomId('appearance_prefix')
      .setLabel('Novo prefixo')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(10);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_appearance_username') {
    const username = interaction.fields.getTextInputValue('appearance_username').trim();
    if (!username) return interaction.reply({ content: '❌ Username inválido.', ephemeral: true });

    appConfig.botAppearance.username = username;
    saveConfig();

    await client.user.setUsername(username).catch(() => {});
    return interaction.reply({ content: '✅ Username atualizado!', ephemeral: true });
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_appearance_avatar') {
    const url = interaction.fields.getTextInputValue('appearance_avatar').trim();
    appConfig.botAppearance.avatarUrl = url || null;
    saveConfig();

    await client.user.setAvatar(url || null).catch(() => {});
    return interaction.reply({ content: '✅ Avatar atualizado!', ephemeral: true });
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_appearance_banner') {
    const url = interaction.fields.getTextInputValue('appearance_banner').trim();
    appConfig.botAppearance.bannerUrl = url || null;
    saveConfig();

    await client.user.setBanner(url || null).catch(() => {});
    return interaction.reply({ content: '✅ Banner atualizado!', ephemeral: true });
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_appearance_prefix') {
    const prefix = interaction.fields.getTextInputValue('appearance_prefix').trim();
    if (!prefix) return interaction.reply({ content: '❌ Prefixo inválido.', ephemeral: true });

    appConfig.botAppearance.prefix = prefix;
    saveConfig();

    return interaction.reply({ content: `✅ Prefixo atualizado para \`${prefix}\``, ephemeral: true });
  }

  if (interaction.isButton() && interaction.customId === 'saved_close') {
    await interaction.deferUpdate();
    return interaction.message.delete().catch(() => {});
  }

  if (interaction.isButton() && interaction.customId === 'saved_create') {
    const modal = new ModalBuilder()
      .setCustomId('modal_saved_create')
      .setTitle('Criar Embed Salva');

    const input = new TextInputBuilder()
      .setCustomId('saved_name')
      .setLabel('Nome da embed')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(50);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  if (interaction.isButton() && interaction.customId === 'saved_list') {
    const saved = getSavedEmbeds(interaction.guildId);
    if (!saved.length) {
      return interaction.reply({ content: '❌ Nenhuma embed salva.', ephemeral: true });
    }

    const container = buildSavedListContainer(interaction.guildId);
    await interaction.channel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });
    return interaction.deferUpdate();
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_saved_create') {
    const name = interaction.fields.getTextInputValue('saved_name').trim();
    const saved = getSavedEmbeds(interaction.guildId);

    if (saved.find(e => e.name.toLowerCase() === name.toLowerCase())) {
      return interaction.reply({ content: '❌ Já existe uma embed com esse nome.', ephemeral: true });
    }

    const sessionId = createSession(interaction.user.id, interaction.channelId, 'saved-create', name);
    const session = getSessionById(sessionId);

    const container = buildBuilderContainer(session);
    const sent = await interaction.channel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });

    session.builderMessageId = sent.id;
    setTimeout(() => sessions.delete(sessionId), 30 * 60 * 1000);

    return interaction.deferUpdate();
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'saved_select') {
    const name = interaction.values[0];
    const saved = getSavedEmbeds(interaction.guildId);
    const entry = saved.find(e => e.name === name);

    if (!entry) {
      return interaction.reply({ content: '❌ Embed não encontrada.', ephemeral: true });
    }

    savedSelections.set(interaction.user.id, name);

    if (entry.buttonActions) {
      for (const [customId, text] of Object.entries(entry.buttonActions)) {
        buttonActions.set(customId, { text });
      }
    }

    const sessionId = createSession(interaction.user.id, interaction.channelId, 'saved-edit', entry.name, entry.doc, entry.channelId);
    const session = getSessionById(sessionId);

    const builder = buildBuilderContainer(session);
    const builderMsg = await interaction.channel.send({
      components: [builder],
      flags: MessageFlags.IsComponentsV2
    });
    session.builderMessageId = builderMsg.id;

    const preview = buildContainerFromDoc(session);
    const previewMsg = await interaction.channel.send({
      components: [preview],
      flags: MessageFlags.IsComponentsV2
    });
    session.previewMessageId = previewMsg.id;

    setTimeout(() => sessions.delete(sessionId), 30 * 60 * 1000);
    return interaction.update({
      components: interaction.message.components,
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (interaction.isButton() && interaction.customId === 'saved_delete') {
    const selected = savedSelections.get(interaction.user.id);
    if (!selected) {
      return interaction.reply({ content: '❌ Selecione uma embed para excluir.', ephemeral: true });
    }

    const cfg = getGuildConfig(interaction.guildId);
    const before = cfg.savedEmbeds.length;
    const embed = cfg.savedEmbeds.find(e => e.name === selected);

    cfg.savedEmbeds = cfg.savedEmbeds.filter(e => e.name !== selected);

    if (embed?.buttonActions) {
      for (const customId of Object.keys(embed.buttonActions)) {
        buttonActions.delete(customId);
      }
    }

    if (cfg.savedEmbeds.length !== before) {
      saveConfig();
    }

    savedSelections.delete(interaction.user.id);

    await interaction.deferUpdate();
    const container = buildSavedListContainer(interaction.guildId);
    return interaction.message.edit({
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (interaction.isButton() && interaction.customId === 'perm_close') {
    await interaction.deferUpdate();
    return interaction.message.delete().catch(() => {});
  }

  if (interaction.isButton() && interaction.customId === 'perm_add_user') {
    const modal = new ModalBuilder()
      .setCustomId('modal_perm_add')
      .setTitle('Autorizar Membro');

    const input = new TextInputBuilder()
      .setCustomId('perm_user_id')
      .setLabel('ID do usuário')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  if (interaction.isButton() && interaction.customId === 'perm_remove_user') {
    const modal = new ModalBuilder()
      .setCustomId('modal_perm_remove')
      .setTitle('Remover Membro');

    const input = new TextInputBuilder()
      .setCustomId('perm_user_id')
      .setLabel('ID do usuário')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_perm_add') {
    const userId = interaction.fields.getTextInputValue('perm_user_id').trim();
    const cfg = getGuildConfig(interaction.guildId);

    if (!cfg.permissions.allowedUserIds.includes(userId)) {
      cfg.permissions.allowedUserIds.push(userId);
      if (CLIENT_ID && !cfg.permissions.allowedUserIds.includes(CLIENT_ID)) {
        cfg.permissions.allowedUserIds.push(CLIENT_ID);
      }
      saveConfig();
    }

    return interaction.reply({ content: '✅ Membro autorizado!', ephemeral: true });
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_perm_remove') {
    const userId = interaction.fields.getTextInputValue('perm_user_id').trim();
    const cfg = getGuildConfig(interaction.guildId);

    cfg.permissions.allowedUserIds = cfg.permissions.allowedUserIds.filter(id => id !== userId);
    if (CLIENT_ID && !cfg.permissions.allowedUserIds.includes(CLIENT_ID)) {
      cfg.permissions.allowedUserIds.push(CLIENT_ID);
    }
    saveConfig();

    return interaction.reply({ content: '✅ Membro removido!', ephemeral: true });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'antispam_action') {
    const action = interaction.values[0];
    const cfg = getGuildConfig(interaction.guildId);
    cfg.antiSpam.action = action;
    saveConfig();

    const container = buildAntiSpamContainer(interaction.guildId);
    await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
  }

  if (interaction.isButton() && interaction.customId === 'antispam_limits') {
    const modal = new ModalBuilder()
      .setCustomId('modal_antispam_limits')
      .setTitle('Limite e Tempo');

    const maxInput = new TextInputBuilder()
      .setCustomId('max_messages')
      .setLabel('Máx mensagens')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const timeInput = new TextInputBuilder()
      .setCustomId('interval_seconds')
      .setLabel('Tempo em segundos')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(maxInput),
      new ActionRowBuilder().addComponents(timeInput)
    );

    return interaction.showModal(modal);
  }

  if (interaction.isButton() && interaction.customId === 'antispam_muterole') {
    const modal = new ModalBuilder()
      .setCustomId('modal_antispam_muterole')
      .setTitle('Cargo Mutado');

    const input = new TextInputBuilder()
      .setCustomId('mute_role_id')
      .setLabel('ID do cargo de mutado')
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  if (interaction.isButton() && interaction.customId === 'antispam_immunes') {
    const modal = new ModalBuilder()
      .setCustomId('modal_antispam_immunes')
      .setTitle('Cargos Imunes');

    const input = new TextInputBuilder()
      .setCustomId('immune_roles')
      .setLabel('IDs separados por vírgula')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  if (interaction.isButton() && interaction.customId === 'antispam_close') {
    await interaction.deferUpdate();
    return interaction.message.delete().catch(() => {});
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_antispam_limits') {
    const cfg = getGuildConfig(interaction.guildId);
    const maxMessages = parseInt(interaction.fields.getTextInputValue('max_messages'));
    const intervalSeconds = parseInt(interaction.fields.getTextInputValue('interval_seconds'));

    if (isNaN(maxMessages) || isNaN(intervalSeconds)) {
      return interaction.reply({ content: '❌ Valores inválidos.', ephemeral: true });
    }

    cfg.antiSpam.maxMessages = Math.max(1, maxMessages);
    cfg.antiSpam.intervalSeconds = Math.max(1, intervalSeconds);
    saveConfig();

    await interaction.deferUpdate();
    const container = buildAntiSpamContainer(interaction.guildId);
    return interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_antispam_muterole') {
    const cfg = getGuildConfig(interaction.guildId);
    const roleId = interaction.fields.getTextInputValue('mute_role_id').trim();
    cfg.antiSpam.muteRoleId = roleId || null;
    saveConfig();

    await interaction.deferUpdate();
    const container = buildAntiSpamContainer(interaction.guildId);
    return interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_antispam_immunes') {
    const cfg = getGuildConfig(interaction.guildId);
    const raw = interaction.fields.getTextInputValue('immune_roles').trim();
    const ids = raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
    cfg.antiSpam.immuneRoleIds = ids;
    saveConfig();

    await interaction.deferUpdate();
    const container = buildAntiSpamContainer(interaction.guildId);
    return interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
  }

  if (interaction.isUserSelectMenu() && interaction.customId === 'perm_users') {
    const draft = permissionDrafts.get(interaction.user.id);
    if (!draft) return interaction.reply({ content: '❌ Sessão inválida.', ephemeral: true });

    draft.allowedUserIds = interaction.values;
    return interaction.update({
      components: interaction.message.components,
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (interaction.isRoleSelectMenu() && interaction.customId === 'perm_roles') {
    const draft = permissionDrafts.get(interaction.user.id);
    if (!draft) return interaction.reply({ content: '❌ Sessão inválida.', ephemeral: true });

    draft.allowedRoleIds = interaction.values;
    return interaction.update({
      components: interaction.message.components,
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (interaction.isButton() && interaction.customId === 'perm_save') {
    const draft = permissionDrafts.get(interaction.user.id);
    if (!draft) return interaction.reply({ content: '❌ Sessão inválida.', ephemeral: true });

    const cfg = getGuildConfig(draft.guildId);
    const users = draft.allowedUserIds || [];
    if (CLIENT_ID && !users.includes(CLIENT_ID)) users.push(CLIENT_ID);

    cfg.permissions.allowedUserIds = users;
    cfg.permissions.allowedRoleIds = draft.allowedRoleIds || [];
    saveConfig();

    permissionDrafts.delete(interaction.user.id);
    return interaction.deferUpdate();
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('builder_action_')) {
    const sessionId = interaction.customId.replace('builder_action_', '');
    const session = getSessionById(sessionId);
    if (!session || session.userId !== interaction.user.id) {
      return interaction.reply({ content: '❌ Sessão inválida.', ephemeral: true });
    }

    const action = interaction.values[0];

    if (action === 'add_text') {
      const modal = new ModalBuilder()
        .setCustomId(`modal_text_${sessionId}`)
        .setTitle('Adicionar Texto');

      const input = new TextInputBuilder()
        .setCustomId('text_content')
        .setLabel('Conteúdo')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(2000);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (action === 'set_color') {
      const modal = new ModalBuilder()
        .setCustomId(`modal_color_${sessionId}`)
        .setTitle('Definir Cor');

      const input = new TextInputBuilder()
        .setCustomId('color_hex')
        .setLabel('Cor HEX (#5865F2)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(7);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (action === 'add_image' || action === 'add_file') {
      const modal = new ModalBuilder()
        .setCustomId(`modal_media_${sessionId}`)
        .setTitle(action === 'add_image' ? 'Adicionar Imagem' : 'Adicionar Arquivo');

      const urlInput = new TextInputBuilder()
        .setCustomId('media_url')
        .setLabel('URL')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(urlInput));
      return interaction.showModal(modal);
    }

    if (action === 'add_separator') {
      const modal = new ModalBuilder()
        .setCustomId(`modal_separator_${sessionId}`)
        .setTitle('Adicionar Separador');

      const input = new TextInputBuilder()
        .setCustomId('separator_spacing')
        .setLabel('Espaçamento (1-5)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(1);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (action === 'add_button') {
      const modal = new ModalBuilder()
        .setCustomId(`modal_button_${sessionId}`)
        .setTitle('Adicionar Botão');

      const label = new TextInputBuilder()
        .setCustomId('button_label')
        .setLabel('Texto do botão')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80);

      const style = new TextInputBuilder()
        .setCustomId('button_style')
        .setLabel('Estilo (1-4)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(1);

      const actionText = new TextInputBuilder()
        .setCustomId('button_action')
        .setLabel('Texto ao clicar')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      const emoji = new TextInputBuilder()
        .setCustomId('button_emoji')
        .setLabel('Emoji (opcional)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(label),
        new ActionRowBuilder().addComponents(style),
        new ActionRowBuilder().addComponents(actionText),
        new ActionRowBuilder().addComponents(emoji)
      );

      return interaction.showModal(modal);
    }

    if (action === 'add_link_button') {
      const modal = new ModalBuilder()
        .setCustomId(`modal_link_${sessionId}`)
        .setTitle('Adicionar Botão de Link');

      const label = new TextInputBuilder()
        .setCustomId('link_label')
        .setLabel('Texto do botão')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80);

      const url = new TextInputBuilder()
        .setCustomId('link_url')
        .setLabel('URL')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const emoji = new TextInputBuilder()
        .setCustomId('link_emoji')
        .setLabel('Emoji (opcional)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(label),
        new ActionRowBuilder().addComponents(url),
        new ActionRowBuilder().addComponents(emoji)
      );

      return interaction.showModal(modal);
    }

    if (action === 'add_select_menu') {
      const modal = new ModalBuilder()
        .setCustomId(`modal_select_${sessionId}`)
        .setTitle('Adicionar Menu de Seleção');

      const placeholder = new TextInputBuilder()
        .setCustomId('select_placeholder')
        .setLabel('Placeholder')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      const options = new TextInputBuilder()
        .setCustomId('select_options')
        .setLabel('Opções (separadas por vírgula)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(placeholder),
        new ActionRowBuilder().addComponents(options)
      );

      return interaction.showModal(modal);
    }

    return interaction.update({
      components: interaction.message.components,
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('builder_channel_')) {
    const sessionId = interaction.customId.replace('builder_channel_', '');
    const session = getSessionById(sessionId);
    if (!session || session.userId !== interaction.user.id) {
      return interaction.reply({ content: '❌ Sessão inválida.', ephemeral: true });
    }

    const selected = interaction.values?.[0];
    session.targetChannelId = selected || session.channelId;

    await updateBuilderMessage(session);
    return interaction.deferUpdate();
  }

  if (interaction.isModalSubmit()) {
    let sessionId = null;
    let type = null;

    if (interaction.customId.startsWith('modal_text_')) {
      type = 'text';
      sessionId = interaction.customId.replace('modal_text_', '');
    } else if (interaction.customId.startsWith('modal_color_')) {
      type = 'color';
      sessionId = interaction.customId.replace('modal_color_', '');
    } else if (interaction.customId.startsWith('modal_media_')) {
      type = 'media';
      sessionId = interaction.customId.replace('modal_media_', '');
    } else if (interaction.customId.startsWith('modal_separator_')) {
      type = 'separator';
      sessionId = interaction.customId.replace('modal_separator_', '');
    } else if (interaction.customId.startsWith('modal_button_')) {
      type = 'button';
      sessionId = interaction.customId.replace('modal_button_', '');
    } else if (interaction.customId.startsWith('modal_link_')) {
      type = 'link';
      sessionId = interaction.customId.replace('modal_link_', '');
    } else if (interaction.customId.startsWith('modal_select_')) {
      type = 'select';
      sessionId = interaction.customId.replace('modal_select_', '');
    } else {
      return;
    }

    const session = getSessionById(sessionId);
    if (!session || session.userId !== interaction.user.id) {
      return interaction.reply({ content: '❌ Sessão inválida.', ephemeral: true });
    }

    if (type === 'text') {
      const content = interaction.fields.getTextInputValue('text_content');
      session.doc[0].components.push({ type: 10, content });
    }

    if (type === 'color') {
      let color = interaction.fields.getTextInputValue('color_hex').trim();
      if (!color.startsWith('#')) color = `#${color}`;
      const hex = color.replace('#', '');
      if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
        return interaction.reply({ content: '❌ Cor inválida.', ephemeral: true });
      }
      session.doc[0].accent_color = color;
    }

    if (type === 'media') {
      const url = interaction.fields.getTextInputValue('media_url');
      session.doc[0].components.push({
        type: 12,
        items: [{ media: { url }, description: null, spoiler: false }]
      });
    }

    if (type === 'separator') {
      const spacingStr = interaction.fields.getTextInputValue('separator_spacing');
      const spacing = spacingStr ? parseInt(spacingStr) : 1;
      session.doc[0].components.push({
        type: 14,
        divider: true,
        spacing: Math.max(1, Math.min(5, spacing))
      });
    }

    if (type === 'button') {
      const label = interaction.fields.getTextInputValue('button_label');
      const style = parseInt(interaction.fields.getTextInputValue('button_style'));
      const actionText = interaction.fields.getTextInputValue('button_action') || 'Clicado!';
      const emoji = interaction.fields.getTextInputValue('button_emoji') || null;

      if (style < 1 || style > 4) {
        return interaction.reply({ content: '❌ Estilo inválido! Use 1-4.', ephemeral: true });
      }

      let row = session.doc[0].components.find(c => c.type === 1 && c.components.length < 5);
      if (!row) {
        row = { type: 1, components: [] };
        session.doc[0].components.push(row);
      }

      const customId = `dynbtn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      buttonActions.set(customId, { text: actionText });

      row.components.push({
        type: 2,
        style,
        label,
        customId,
        emoji: emoji || undefined
      });
    }

    if (type === 'link') {
      const label = interaction.fields.getTextInputValue('link_label');
      const url = interaction.fields.getTextInputValue('link_url');
      const emoji = interaction.fields.getTextInputValue('link_emoji') || null;

      let row = session.doc[0].components.find(c => c.type === 1 && c.components.length < 5);
      if (!row) {
        row = { type: 1, components: [] };
        session.doc[0].components.push(row);
      }

      row.components.push({
        type: 2,
        style: 5,
        label,
        url,
        emoji: emoji || undefined
      });
    }

    if (type === 'select') {
      const placeholder = interaction.fields.getTextInputValue('select_placeholder') || 'Escolha...';
      const optionsRaw = interaction.fields.getTextInputValue('select_options');
      const options = optionsRaw.split(',').map(o => o.trim()).filter(Boolean);

      if (!options.length) {
        return interaction.reply({ content: '❌ Adicione pelo menos uma opção.', ephemeral: true });
      }

      const customId = `dynselect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      selectActions.set(customId, {});

      session.doc[0].components.push({
        type: 1,
        components: [{
          type: 3,
          customId,
          placeholder,
          options: options.slice(0, 25).map((opt, i) => ({
            label: opt,
            value: `opt_${i + 1}`
          }))
        }]
      });
    }

    await interaction.deferUpdate();
    return updateBuilderMessage(session);
  }

  if (interaction.isButton() && interaction.customId.startsWith('builder_preview_')) {
    const sessionId = interaction.customId.replace('builder_preview_', '');
    const session = getSessionById(sessionId);
    if (!session || session.userId !== interaction.user.id) {
      return interaction.reply({ content: '❌ Sessão inválida.', ephemeral: true });
    }

    const container = buildContainerFromDoc(session);
    await interaction.channel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });
    return interaction.deferUpdate();
  }

  if (interaction.isButton() && interaction.customId.startsWith('builder_send_')) {
    const sessionId = interaction.customId.replace('builder_send_', '');
    const session = getSessionById(sessionId);
    if (!session || session.userId !== interaction.user.id) {
      return interaction.reply({ content: '❌ Sessão inválida.', ephemeral: true });
    }

    const targetChannel = await client.channels.fetch(session.targetChannelId).catch(() => null);
    if (!targetChannel) {
      return interaction.reply({ content: '❌ Canal inválido.', ephemeral: true });
    }

    const container = buildContainerFromDoc(session);
    await targetChannel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });

    if (session.mode === 'saved-create' || session.mode === 'saved-edit') {
      const cfg = getGuildConfig(interaction.guildId);
      const existing = cfg.savedEmbeds.find(e => e.name === session.savedName);

      const customIds = extractButtonCustomIds(session.doc);
      const actionMap = {};
      for (const id of customIds) {
        const action = buttonActions.get(id);
        if (action?.text) actionMap[id] = action.text;
      }

      if (existing) {
        existing.doc = session.doc;
        existing.channelId = session.targetChannelId;
        existing.buttonActions = actionMap;
      } else {
        cfg.savedEmbeds.push({
          name: session.savedName,
          channelId: session.targetChannelId,
          doc: session.doc,
          buttonActions: actionMap
        });
      }
      saveConfig();
    }

    await interaction.deferUpdate();
    await interaction.message.delete().catch(() => {});
    if (session.previewMessageId) {
      await interaction.channel.messages.delete(session.previewMessageId).catch(() => {});
    }
    sessions.delete(sessionId);
  }

  if (interaction.isButton() && interaction.customId.startsWith('builder_clear_')) {
    const sessionId = interaction.customId.replace('builder_clear_', '');
    const session = getSessionById(sessionId);
    if (!session || session.userId !== interaction.user.id) {
      return interaction.reply({ content: '❌ Sessão inválida.', ephemeral: true });
    }

    session.doc[0] = { components: [], accent_color: null };
    await interaction.deferUpdate();
    return updateBuilderMessage(session);
  }

  if (interaction.isButton() && interaction.customId.startsWith('builder_cancel_')) {
    const sessionId = interaction.customId.replace('builder_cancel_', '');
    const session = getSessionById(sessionId);
    if (!session || session.userId !== interaction.user.id) {
      return interaction.reply({ content: '❌ Sessão inválida.', ephemeral: true });
    }

    await interaction.deferUpdate();
    await interaction.message.delete().catch(() => {});
    if (session.previewMessageId) {
      await interaction.channel.messages.delete(session.previewMessageId).catch(() => {});
    }
    sessions.delete(sessionId);
  }

  if (interaction.isButton() && interaction.customId.startsWith('dynbtn_')) {
    const action = buttonActions.get(interaction.customId);
    if (!action) return interaction.reply({ content: '⚠️ Ação não encontrada.', ephemeral: true });
    return interaction.reply({ content: action.text || 'Você clicou!', ephemeral: true });
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('dynselect_')) {
    const value = interaction.values?.[0];
    return interaction.reply({ content: `✅ Você escolheu: ${value}`, ephemeral: true });
  }
});

// Limpeza automática (posts > 30d + destaque)
setInterval(async () => {
  const limit = Date.now() - 30 * 24 * 60 * 60 * 1000;
  igdb.prepare('DELETE FROM instagram_posts WHERE created_at < ?').run(limit);
  igdb.prepare('DELETE FROM instagram_likes WHERE post_id NOT IN (SELECT id FROM instagram_posts)').run();
  igdb.prepare('DELETE FROM instagram_comments WHERE post_id NOT IN (SELECT id FROM instagram_posts)').run();

  for (const guildId of Object.keys(appConfig.guilds || {})) {
    const ig = getInstagramConfig(guildId);
    const state = getHighlightState(guildId);
    if (!state || !state.message_id) continue;

    if (ig.clearHighlightEnabled) {
      const clearAfter = (ig.clearHighlightAfterDays || 7) * 24 * 60 * 60 * 1000;
      if (state.updated_at && Date.now() - state.updated_at >= clearAfter) {
        const channel = await client.channels.fetch(ig.highlightChannelId).catch(() => null);
        if (channel) {
          await channel.messages.delete(state.message_id).catch(() => {});
        }
        if (ig.highlightRoleId && state.user_id) {
          const guild = await client.guilds.fetch(guildId).catch(() => null);
          if (guild) {
            const member = await guild.members.fetch(state.user_id).catch(() => null);
            if (member) await member.roles.remove(ig.highlightRoleId).catch(() => {});
          }
        }
        setHighlightState(guildId, {
          post_id: null,
          message_id: null,
          user_id: null,
          updated_at: Date.now(),
          last_post_id: state.post_id ?? state.last_post_id
        });
      }
    }
  }
}, 60 * 60 * 1000);

// Erros
client.on('error', (err) => console.error('❌ Client error:', err));
process.on('unhandledRejection', (err) => console.error('❌ Unhandled rejection:', err));

// Login
client.login(TOKEN).catch((err) => {
  console.error('❌ Falha no login:', err);
  process.exit(1);
});
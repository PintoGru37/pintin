import { Client, GatewayIntentBits } from 'discord.js';
import Database from 'better-sqlite3';
import { config } from 'dotenv';
import fs from 'node:fs';

config();

export const DEFAULT_PREFIX = process.env.PREFIX || 'u.';
export const TOKEN = process.env.DISCORD_TOKEN;
export const CLIENT_ID = process.env.CLIENT_ID;

export const CONFIG_PATH = './config.json';

export const sessions = new Map();
export const permissionDrafts = new Map();
export const buttonActions = new Map();
export const selectActions = new Map();
export const spamTracker = new Map();
export const savedSelections = new Map();
export const commandPermissionDrafts = new Map();
export const commandPanels = new Map();
export const logsPanels = new Map();
export const autoRolePanels = new Map();

export const DATABASE_DIR = './database';
export const INSTAGRAM_DB_PATH = `${DATABASE_DIR}/instagram.db`;

if (!fs.existsSync(DATABASE_DIR)) {
  fs.mkdirSync(DATABASE_DIR, { recursive: true });
}

export const igdb = new Database(INSTAGRAM_DB_PATH);

gb.exec(`
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

export function ensureInstagramColumn(table, column, type) {
  const cols = igdb.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) {
    igdb.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
  }
}

ensureInstagramColumn('instagram_highlight_state', 'last_post_id', 'INTEGER');
ensureInstagramColumn('instagram_posts', 'caption', 'TEXT');

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});
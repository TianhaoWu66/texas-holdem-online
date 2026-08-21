import { env } from "cloudflare:workers";
import { DEFAULT_PROFILE_AVATAR, isProfileAvatar, ProfileAvatar } from "./profile";

export type AccountProfile = {
  id: string;
  username: string;
  nickname: string;
  avatar: ProfileAvatar;
};

type StoredAccount = AccountProfile & { password_hash: string; password_salt: string };
const SESSION_COOKIE = "spice_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_ITERATIONS = 100_000;

const usersSql = `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  nickname TEXT NOT NULL,
  avatar TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`;
const sessionsSql = `CREATE TABLE IF NOT EXISTS account_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
)`;
const sessionUserIndexSql = "CREATE INDEX IF NOT EXISTS idx_account_sessions_user_id ON account_sessions(user_id)";
const sessionExpiryIndexSql = "CREATE INDEX IF NOT EXISTS idx_account_sessions_expires_at ON account_sessions(expires_at)";

export async function ensureAccountSchema() {
  if (!env.DB) throw new Error("账号数据库尚未连接");
  await env.DB.batch([
    env.DB.prepare(usersSql),
    env.DB.prepare(sessionsSql),
    env.DB.prepare(sessionUserIndexSql),
    env.DB.prepare(sessionExpiryIndexSql),
  ]);
}

export function normalizeUsername(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function validateRegistration(username: string, password: string, nickname: string) {
  if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error("账号需为 3–24 位字母、数字或下划线");
  if (password.length < 6 || password.length > 72) throw new Error("密码长度需为 6–72 位");
  if (!nickname || nickname.length > 12) throw new Error("昵称长度需为 1–12 个字符");
}

export async function createAccount(username: string, password: string, nickname: string) {
  await ensureAccountSchema();
  const salt = randomText(16);
  const account: AccountProfile = { id: crypto.randomUUID(), username, nickname, avatar: DEFAULT_PROFILE_AVATAR };
  const passwordHash = await derivePassword(password, salt);
  const now = Date.now();
  try {
    await env.DB.prepare("INSERT INTO users (id, username, password_hash, password_salt, nickname, avatar, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(account.id, account.username, passwordHash, salt, account.nickname, account.avatar, now, now).run();
  } catch {
    throw new Error("这个账号已经被注册");
  }
  return account;
}

export async function verifyAccount(username: string, password: string) {
  await ensureAccountSchema();
  const row = await env.DB.prepare("SELECT id, username, password_hash, password_salt, nickname, avatar FROM users WHERE username = ?")
    .bind(username).first<StoredAccount>();
  if (!row || !(await safeEqual(row.password_hash, await derivePassword(password, row.password_salt)))) throw new Error("账号或密码不正确");
  return publicProfile(row);
}

export async function createAccountSession(userId: string) {
  await ensureAccountSchema();
  const token = randomText(32);
  const tokenHash = await sha256(token);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO account_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(tokenHash, userId, now + SESSION_SECONDS * 1000, now).run();
  return token;
}

export async function getAccountFromRequest(request: Request): Promise<AccountProfile | null> {
  await ensureAccountSchema();
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`SELECT users.id, users.username, users.nickname, users.avatar, account_sessions.expires_at
    FROM account_sessions JOIN users ON users.id = account_sessions.user_id
    WHERE account_sessions.token_hash = ?`).bind(tokenHash).first<AccountProfile & { expires_at: number }>();
  if (!row || row.expires_at <= Date.now()) {
    if (row) await env.DB.prepare("DELETE FROM account_sessions WHERE token_hash = ?").bind(tokenHash).run();
    return null;
  }
  return publicProfile(row);
}

export async function updateAccountAvatar(userId: string, avatar: unknown) {
  if (!isProfileAvatar(avatar)) throw new Error("请选择有效头像");
  await env.DB.prepare("UPDATE users SET avatar = ?, updated_at = ? WHERE id = ?").bind(avatar, Date.now(), userId).run();
  return avatar;
}

export async function deleteAccountSession(request: Request) {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM account_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

export function sessionCookie(token: string, request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`;
}

export function expiredSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function publicProfile(row: { id: string; username: string; nickname: string; avatar: string }): AccountProfile {
  return { id: row.id, username: row.username, nickname: row.nickname, avatar: isProfileAvatar(row.avatar) ? row.avatar : DEFAULT_PROFILE_AVATAR };
}

function readCookie(header: string | null, name: string) {
  return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
}

function randomText(length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return toBase64Url(bytes);
}

async function derivePassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: PASSWORD_ITERATIONS }, key, 256);
  return toBase64Url(new Uint8Array(bits));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(digest));
}

async function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

# -*- coding: utf-8 -*-
"""账号与登录逻辑（Python 移植版，与 lib/accounts.ts 行为一致）。"""
import base64
import hashlib
import hmac
import re
import secrets
import uuid

try:
    from .profile import DEFAULT_PROFILE_AVATAR, PROFILE_AVATARS
except ImportError:
    from profile import DEFAULT_PROFILE_AVATAR, PROFILE_AVATARS

SESSION_COOKIE = "poker_session"
SESSION_SECONDS = 60 * 60 * 24 * 30
PASSWORD_ITERATIONS = 100_000

USERNAME_RE = re.compile(r"^[a-z0-9_]{3,24}$")


def _to_base64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _random_text(length):
    return _to_base64url(secrets.token_bytes(length))


def _derive_password(password, salt):
    return _to_base64url(hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), PASSWORD_ITERATIONS, dklen=32))


def _sha256(value):
    return _to_base64url(hashlib.sha256(value.encode("utf-8")).digest())


def _safe_equal(left, right):
    return hmac.compare_digest(left.encode("ascii"), right.encode("ascii"))


def normalize_username(value):
    return str(value or "").strip().lower()


def validate_registration(username, password, nickname):
    if not USERNAME_RE.match(username):
        raise ValueError("账号需为 3–24 位字母、数字或下划线")
    if len(password) < 6 or len(password) > 72:
        raise ValueError("密码长度需为 6–72 位")
    if not nickname or len(nickname) > 12:
        raise ValueError("昵称长度需为 1–12 个字符")


def is_profile_avatar(value):
    return isinstance(value, str) and value in PROFILE_AVATARS


def public_profile(row):
    return {
        "id": row["id"],
        "username": row["username"],
        "nickname": row["nickname"],
        "avatar": row["avatar"] if is_profile_avatar(row["avatar"]) else DEFAULT_PROFILE_AVATAR,
    }


# ---------- 数据访问（由 app.py 注入连接） ----------

def create_account(db, username, password, nickname):
    salt = _random_text(16)
    account = {"id": str(uuid.uuid4()), "username": username, "nickname": nickname, "avatar": DEFAULT_PROFILE_AVATAR}
    password_hash = _derive_password(password, salt)
    now = int(__import__("time").time() * 1000)
    try:
        db.execute(
            "INSERT INTO users (id, username, password_hash, password_salt, nickname, avatar, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (account["id"], account["username"], password_hash, salt, account["nickname"], account["avatar"], now, now),
        )
    except Exception:
        raise ValueError("这个账号已经被注册")
    return account


def verify_account(db, username, password):
    row = db.execute(
        "SELECT id, username, password_hash, password_salt, nickname, avatar FROM users WHERE username = ?",
        (username,),
    ).fetchone()
    if not row or not _safe_equal(row["password_hash"], _derive_password(password, row["password_salt"])):
        raise ValueError("账号或密码不正确")
    return public_profile(row)


def create_account_session(db, user_id):
    token = _random_text(32)
    token_hash = _sha256(token)
    now = int(__import__("time").time() * 1000)
    db.execute(
        "INSERT INTO account_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        (token_hash, user_id, now + SESSION_SECONDS * 1000, now),
    )
    return token


def get_account_from_request(db, cookie_header):
    token = read_cookie(cookie_header, SESSION_COOKIE)
    if not token:
        return None
    token_hash = _sha256(token)
    row = db.execute(
        "SELECT users.id, users.username, users.nickname, users.avatar, account_sessions.expires_at "
        "FROM account_sessions JOIN users ON users.id = account_sessions.user_id "
        "WHERE account_sessions.token_hash = ?",
        (token_hash,),
    ).fetchone()
    if not row or row["expires_at"] <= int(__import__("time").time() * 1000):
        if row:
            db.execute("DELETE FROM account_sessions WHERE token_hash = ?", (token_hash,))
        return None
    return public_profile(row)


def update_account_avatar(db, user_id, avatar):
    if not is_profile_avatar(avatar):
        raise ValueError("请选择有效头像")
    db.execute(
        "UPDATE users SET avatar = ?, updated_at = ? WHERE id = ?",
        (avatar, int(__import__("time").time() * 1000), user_id),
    )
    return avatar


def delete_account_session(db, cookie_header):
    token = read_cookie(cookie_header, SESSION_COOKIE)
    if token:
        db.execute("DELETE FROM account_sessions WHERE token_hash = ?", (_sha256(token),))


def session_cookie(token, secure):
    secure_part = "; Secure" if secure else ""
    return f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_SECONDS}{secure_part}"


def expired_session_cookie(secure):
    secure_part = "; Secure" if secure else ""
    return f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{secure_part}"


def read_cookie(header, name):
    if not header:
        return ""
    for part in header.split(";"):
        part = part.strip()
        if part.startswith(name + "="):
            return part[len(name) + 1:]
    return ""

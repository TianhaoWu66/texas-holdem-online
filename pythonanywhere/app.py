# -*- coding: utf-8 -*-
"""德州扑克 · Flask 后端（PythonAnywhere 版）。

API：
  GET  /api/room?code=XXXXXX     读取房间（按查看者身份隐藏底牌）
  POST /api/room                 创建/加入/人机/下一手/行动/观战/退观/语音
  GET/POST /api/auth             账号注册/登录/退出/头像
"""
import json
import os
import re
import secrets
import sqlite3
import time

from flask import Flask, g, request, send_from_directory, Response

try:
    from . import accounts, poker
except ImportError:  # 直接 python app.py 运行时
    import accounts
    import poker

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
DB_PATH = os.environ.get("POKER_DB_PATH", os.path.join(BASE_DIR, "site.db"))

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  nickname TEXT NOT NULL,
  avatar TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS account_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_sessions_user_id ON account_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_account_sessions_expires_at ON account_sessions(expires_at);
"""

app = Flask(__name__)

CHAT_PHRASES = ["老叟戏顽童", "神之一手", "你的计谋被我识破了"]


def now_ms():
    return int(time.time() * 1000)


def get_db():
    if "db" not in g:
        db = sqlite3.connect(DB_PATH)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA busy_timeout = 5000")
        g.db = db
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def ensure_schema():
    get_db().executescript(SCHEMA_SQL)


def _json_response(payload, status=200):
    return Response(json.dumps(payload, ensure_ascii=False), status=status, mimetype="application/json")


def _is_secure():
    forwarded = request.headers.get("X-Forwarded-Proto", "")
    return forwarded.lower() == "https" or request.is_secure


def _clean_code(value):
    return re.sub(r"[^A-Z0-9]", "", str(value or "").strip().upper())[:6]


def _random_code():
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(6))


def _clamp_max_players(value):
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = 6
    return max(2, min(6, number))


def _load_room(code):
    row = get_db().execute("SELECT state, version FROM rooms WHERE code = ?", (code,)).fetchone()
    if not row:
        raise ValueError("找不到这个房间")
    return {"state": json.loads(row["state"]), "version": row["version"]}


def _save_room(code, state, version):
    cursor = get_db().execute(
        "UPDATE rooms SET state = ?, version = version + 1, updated_at = ? WHERE code = ? AND version = ?",
        (json.dumps(state, ensure_ascii=False), now_ms(), code, version),
    )
    if cursor.rowcount == 0:
        raise ValueError("房间刚刚发生了变化，请重试")
    return version + 1


def public_poker_state(state, viewer_id=None, is_spectator=False):
    """隐藏他人底牌；观战者看不到任何底牌。"""
    players = []
    for p in state["players"]:
        copy = dict(p)
        if is_spectator or (viewer_id is not None and p["id"] != viewer_id):
            copy["hole"] = []
        copy.pop("token", None)
        copy.pop("accountId", None)
        players.append(copy)
    public = dict(state)
    public["players"] = players
    public["chatEvents"] = state.get("chatEvents") or []
    public["nextChatEventId"] = state.get("nextChatEventId") or 1
    return public


def find_player(state, account, token):
    return next(
        (p for p in state["players"]
         if (p.get("accountId") == account["id"] if account else p.get("token") == token)),
        None,
    )


@app.route("/api/room", methods=["GET"])
def room_get():
    try:
        ensure_schema()
        code = _clean_code(request.args.get("code"))
        viewer_id = request.args.get("viewerId") or None
        spectator_id = request.args.get("spectatorId") or None
        is_spectator = bool(spectator_id)
        room = _load_room(code)
        return _json_response({
            "code": code, "version": room["version"],
            "state": public_poker_state(room["state"], viewer_id, is_spectator),
        })
    except ValueError as error:
        return _json_response({"error": str(error)}, 404)


@app.route("/api/room", methods=["POST"])
def room_post():
    try:
        ensure_schema()
        db = get_db()
        body = request.get_json(silent=True) or {}
        account = accounts.get_account_from_request(db, request.headers.get("Cookie"))
        name = (account["nickname"] if account else str(body.get("name") or "").strip())[:12]
        token = str(body.get("token") or "")
        command = body.get("command")
        profile = {"accountId": account["id"], "avatar": account["avatar"]} if account else None

        if command == "create":
            if not name:
                raise ValueError("请输入昵称")
            max_players = _clamp_max_players(body.get("maxPlayers"))
            for _ in range(5):
                code = _random_code()
                state = poker.create_poker_lobby(name, max_players, token or secrets.token_urlsafe(24), profile)
                state["chatEvents"] = []
                state["nextChatEventId"] = 1
                cursor = db.execute(
                    "INSERT OR IGNORE INTO rooms (code, state, version, updated_at) VALUES (?, ?, 1, ?)",
                    (code, json.dumps(state, ensure_ascii=False), now_ms()),
                )
                if cursor.rowcount:
                    db.commit()
                    return _json_response({
                        "code": code, "version": 1,
                        "token": state["players"][0]["token"],
                        "playerId": state["players"][0]["id"],
                        "state": public_poker_state(state, state["players"][0]["id"], False),
                    })
            raise ValueError("暂时无法创建房间，请重试")

        code = _clean_code(body.get("code"))
        room = _load_room(code)
        state = room["state"]
        requester = find_player(state, account, token)

        if command == "join":
            if not name:
                raise ValueError("请输入昵称")
            join_token = token or secrets.token_urlsafe(24)
            if requester is not None:
                if account:
                    requester["name"] = account["nickname"]
                    requester["avatar"] = account["avatar"]
                joined = requester
                version = room["version"] if not account else _save_room(code, state, room["version"])
            else:
                poker.add_poker_player(state, name, join_token, profile)
                joined = state["players"][-1]
                version = _save_room(code, state, room["version"])
            db.commit()
            return _json_response({
                "code": code, "version": version,
                "token": joined.get("token") or join_token,
                "playerId": joined["id"],
                "state": public_poker_state(state, joined["id"], False),
            })

        if command == "addBot":
            if not requester or requester["id"] != state["hostId"]:
                raise ValueError("只有房主可以添加人机")
            poker.add_poker_bot(state, str(body.get("difficulty") or "normal"))
        elif command == "removeBot":
            if not requester or requester["id"] != state["hostId"]:
                raise ValueError("只有房主可以移除人机")
            poker.remove_poker_bot(state, str(body.get("botId") or ""))
        elif command == "start":
            if not requester or requester["id"] != state["hostId"]:
                raise ValueError("只有房主可以开始")
            poker.start_hand(state)
            poker.run_poker_bot_turns(state)
        elif command == "action" and body.get("action"):
            if not requester:
                raise ValueError("玩家身份已失效，请重新加入")
            poker.apply_poker_action(state, requester["id"], body["action"])
            poker.run_poker_bot_turns(state)
        elif command == "chat" and body.get("phrase"):
            if not requester:
                raise ValueError("玩家身份已失效，请重新加入")
            phrase = str(body.get("phrase") or "")
            if phrase not in CHAT_PHRASES:
                raise ValueError("这条语音不存在")
            events = state.get("chatEvents") or []
            event_id = state.get("nextChatEventId") or (events[-1]["id"] + 1 if events else 1)
            events.append({"id": event_id, "playerId": requester["id"], "playerName": requester["name"], "playerColor": requester["color"], "phrase": phrase})
            state["chatEvents"] = events[-20:]
            state["nextChatEventId"] = event_id + 1
        elif command == "spectate":
            spectator_id = str(body.get("spectatorId") or "").strip() or secrets.token_urlsafe(12)
            poker.add_spectator(state, name or "观众", spectator_id)
            db.commit()
            version = _save_room(code, state, room["version"])
            return _json_response({"code": code, "version": version, "spectatorId": spectator_id, "state": public_poker_state(state, None, True)})
        elif command == "unspectate":
            poker.remove_spectator(state, str(body.get("spectatorId") or ""))
        else:
            raise ValueError("未知操作")

        version = _save_room(code, state, room["version"])
        db.commit()
        viewer_id = requester["id"] if requester else None
        return _json_response({"code": code, "version": version, "state": public_poker_state(state, viewer_id, False)})
    except ValueError as error:
        try:
            get_db().rollback()
        except Exception:
            pass
        return _json_response({"error": str(error)}, 400)
    except Exception as error:
        try:
            get_db().rollback()
        except Exception:
            pass
        return _json_response({"error": str(error)}, 500)


@app.route("/api/auth", methods=["GET"])
def auth_get():
    try:
        ensure_schema()
        user = accounts.get_account_from_request(get_db(), request.headers.get("Cookie"))
        return _json_response({"user": user})
    except Exception as error:
        return _json_response({"error": str(error)}, 500)


@app.route("/api/auth", methods=["POST"])
def auth_post():
    try:
        ensure_schema()
        db = get_db()
        body = request.get_json(silent=True) or {}
        action = body.get("action")
        secure = _is_secure()
        if action == "register":
            username = accounts.normalize_username(body.get("username"))
            password = str(body.get("password") or "")
            nickname = str(body.get("nickname") or "").strip()[:12]
            accounts.validate_registration(username, password, nickname)
            user = accounts.create_account(db, username, password, nickname)
            token = accounts.create_account_session(db, user["id"])
            db.commit()
            response = _json_response({"user": user})
            response.headers["Set-Cookie"] = accounts.session_cookie(token, secure)
            return response
        if action == "login":
            user = accounts.verify_account(db, accounts.normalize_username(body.get("username")), str(body.get("password") or ""))
            token = accounts.create_account_session(db, user["id"])
            db.commit()
            response = _json_response({"user": user})
            response.headers["Set-Cookie"] = accounts.session_cookie(token, secure)
            return response
        if action == "logout":
            accounts.delete_account_session(db, request.headers.get("Cookie"))
            db.commit()
            response = _json_response({"user": None})
            response.headers["Set-Cookie"] = accounts.expired_session_cookie(secure)
            return response
        if action == "avatar":
            user = accounts.get_account_from_request(db, request.headers.get("Cookie"))
            if not user:
                raise ValueError("请先登录账号")
            avatar = accounts.update_account_avatar(db, user["id"], body.get("avatar"))
            db.commit()
            return _json_response({"user": {**user, "avatar": avatar}})
        raise ValueError("未知账号操作")
    except ValueError as error:
        try:
            get_db().rollback()
        except Exception:
            pass
        return _json_response({"error": str(error)}, 400)
    except Exception as error:
        try:
            get_db().rollback()
        except Exception:
            pass
        return _json_response({"error": str(error)}, 500)


@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    if filename.startswith("api/"):
        return _json_response({"error": "接口不存在"}, 404)
    return send_from_directory(STATIC_DIR, filename)


if __name__ == "__main__":
    with app.app_context():
        ensure_schema()
    print(f"德州扑克 local server -> http://127.0.0.1:5001  (db: {DB_PATH})")
    app.run(host="127.0.0.1", port=5001, debug=False)

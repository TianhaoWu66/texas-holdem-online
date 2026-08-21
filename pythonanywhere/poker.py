# -*- coding: utf-8 -*-
"""德州扑克核心引擎（Python 移植版，与 lib/poker.ts 行为一致）。"""
import random
import uuid

PLAYER_COLORS = ["#e6a23c", "#df6b57", "#5f9b76", "#5f7dad", "#8b6bb1", "#c98a3d"]
STARTING_CHIPS = 1000
SMALL_BLIND = 10
BIG_BLIND = 20
SUIT_SYMBOLS = ["♠", "♥", "♦", "♣"]
RANK_LABELS = {2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A"}
BOT_NAMES = {
    "easy": ["新手赌徒", "菜鸟", "小跟注"],
    "normal": ["河牌高手", "诈唬者", "紧手玩家"],
    "hard": ["德州宗师", "赌神", "冷面杀手"],
}
HAND_NAMES = ["高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺"]


def card_label(card):
    return f"{RANK_LABELS[card['r']]}{SUIT_SYMBOLS[card['s']]}"


def _shuffle(values):
    copy_list = list(values)
    random.shuffle(copy_list)
    return copy_list


def _full_deck():
    return [{"r": r, "s": s} for s in range(4) for r in range(2, 15)]


def _new_id():
    return str(uuid.uuid4())


# ---------- 牌型判定 ----------
def evaluate5(cards):
    ranks = sorted([c["r"] for c in cards], reverse=True)
    suits = [c["s"] for c in cards]
    is_flush = all(s == suits[0] for s in suits)
    uniq = sorted(set(ranks), reverse=True)
    is_straight = len(uniq) == 5 and (ranks[0] - ranks[4] == 4 or (ranks[0] == 14 and ranks[1] == 5 and ranks[4] == 2))
    straight_high = 5 if (is_straight and ranks[0] == 14 and ranks[1] == 5) else (ranks[0] if is_straight else 0)
    if is_flush and is_straight:
        return {"category": 8, "ranks": [straight_high]}
    counts = {}
    for r in ranks:
        counts[r] = counts.get(r, 0) + 1
    groups = sorted(counts.items(), key=lambda kv: (-kv[1], -kv[0]))
    g0 = groups[0]
    g1 = groups[1] if len(groups) > 1 else None
    if g0[1] == 4:
        return {"category": 7, "ranks": [g0[0], groups[1][0]]}
    if g0[1] == 3 and g1 and g1[1] == 2:
        return {"category": 6, "ranks": [g0[0], g1[0]]}
    if is_flush:
        return {"category": 5, "ranks": ranks}
    if is_straight:
        return {"category": 4, "ranks": [straight_high]}
    if g0[1] == 3:
        return {"category": 3, "ranks": [g0[0]] + [g[0] for g in groups[1:]]}
    if g0[1] == 2 and g1 and g1[1] == 2:
        return {"category": 2, "ranks": [g0[0], g1[0], groups[2][0]]}
    if g0[1] == 2:
        return {"category": 1, "ranks": [g0[0]] + [g[0] for g in groups[1:]]}
    return {"category": 0, "ranks": ranks}


def evaluate_best(cards):
    if len(cards) < 5:
        return {"category": 0, "ranks": sorted([c["r"] for c in cards], reverse=True)}
    if len(cards) == 5:
        return evaluate5(cards)
    n = len(cards)
    best = None
    for a in range(n):
        for b in range(a + 1, n):
            for c in range(b + 1, n):
                for d in range(c + 1, n):
                    for e in range(d + 1, n):
                        five = [cards[a], cards[b], cards[c], cards[d], cards[e]]
                        value = evaluate5(five)
                        if best is None or compare_hands(value, best) > 0:
                            best = value
    return best


def compare_hands(a, b):
    if a["category"] != b["category"]:
        return a["category"] - b["category"]
    for i in range(max(len(a["ranks"]), len(b["ranks"]))):
        av = a["ranks"][i] if i < len(a["ranks"]) else 0
        bv = b["ranks"][i] if i < len(b["ranks"]) else 0
        if av != bv:
            return av - bv
    return 0


def hand_name(value):
    return HAND_NAMES[value["category"]]


# ---------- 大厅 ----------
def _make_player(name, token, color, profile=None, is_bot=False, difficulty=None):
    profile = profile or {}
    return {
        "id": _new_id(), "token": token, "name": name, "color": color,
        "avatar": "🤖" if is_bot else profile.get("avatar"),
        "accountId": profile.get("accountId"),
        "chips": STARTING_CHIPS, "startingChips": STARTING_CHIPS, "bankruptcies": 0,
        "hole": [], "bet": 0, "totalBet": 0, "status": "active",
        **({"isBot": True, "botDifficulty": difficulty} if is_bot else {}),
    }


def create_poker_lobby(host_name, max_players, token, profile=None):
    host = _make_player(host_name, token, PLAYER_COLORS[0], profile)
    return {
        "status": "lobby", "maxPlayers": max_players, "hostId": host["id"],
        "players": [host], "spectators": [],
        "deck": [], "community": [], "pot": 0, "currentBet": 0, "dealerIndex": 0,
        "currentPlayerIndex": 0, "round": "preflop", "handNumber": 0,
        "minRaise": BIG_BLIND, "lastAction": "", "log": [f"{host_name} 创建了牌局"],
        "winnerIds": [],
    }


def add_poker_player(state, name, token, profile=None):
    if state["status"] != "lobby":
        raise ValueError("牌局已经开始")
    if len(state["players"]) >= state["maxPlayers"]:
        raise ValueError("座位已满")
    if any(p["name"] == name for p in state["players"]):
        raise ValueError("这个昵称已被使用")
    state["players"].append(_make_player(name, token, PLAYER_COLORS[len(state["players"])], profile))
    state["log"].append(f"{name} 加入了牌局")
    return state


def add_poker_bot(state, difficulty):
    if state["status"] != "lobby":
        raise ValueError("牌局已经开始")
    if len(state["players"]) >= state["maxPlayers"]:
        raise ValueError("座位已满")
    if difficulty not in BOT_NAMES:
        raise ValueError("人机难度无效")
    used = {p["name"] for p in state["players"]}
    base = next((n for n in BOT_NAMES[difficulty] if n not in used), BOT_NAMES[difficulty][0])
    name = base
    suffix = 2
    while name in used:
        name = f"{BOT_NAMES[difficulty][0]}{suffix}"
        suffix += 1
    state["players"].append(_make_player(name, None, PLAYER_COLORS[len(state["players"])], is_bot=True, difficulty=difficulty))
    state["log"].append(f"{name}（人机）加入了牌局")
    return state


def remove_poker_bot(state, bot_id):
    if state["status"] != "lobby":
        raise ValueError("牌局已经开始")
    index = next((i for i, p in enumerate(state["players"]) if p["id"] == bot_id and p.get("isBot")), -1)
    if index < 0:
        raise ValueError("找不到这个人机玩家")
    bot = state["players"].pop(index)
    for i, p in enumerate(state["players"]):
        p["color"] = PLAYER_COLORS[i]
    state["log"].append(f"{bot['name']} 离开了牌局")
    return state


# ---------- 开牌 ----------
def _active_players(state):
    return [p for p in state["players"] if p["status"] in ("active", "allin")]


def _post_blind(state, player, amount):
    put = min(player["chips"], amount)
    player["chips"] -= put
    player["bet"] += put
    player["totalBet"] += put
    state["pot"] += put
    state["currentBet"] = max(state["currentBet"], player["bet"])
    if player["chips"] == 0:
        player["status"] = "allin"
    state["log"].append(f"{player['name']} 下盲注 {put}")


def _seat_order(state):
    n = len(state["players"])
    return [(state["dealerIndex"] + step) % n for step in range(1, n + 1)]


def _next_active_index(state, from_index):
    n = len(state["players"])
    for step in range(1, n + 1):
        idx = (from_index + step) % n
        if state["players"][idx]["status"] == "active":
            return idx
    return -1


def start_hand(state):
    if state["status"] not in ("handEnded", "lobby"):
        raise ValueError("当前不能开局")
    seated = [p for p in state["players"] if p["chips"] > 0]
    if len(seated) < 2:
        raise ValueError("至少需要两名有筹码的玩家")
    for p in state["players"]:
        p["hole"] = []
        p["bet"] = 0
        p["totalBet"] = 0
        p["status"] = "active" if p["chips"] > 0 else "out"
    state["deck"] = _shuffle(_full_deck())
    state["community"] = []
    state["pot"] = 0
    state["currentBet"] = 0
    state["minRaise"] = BIG_BLIND
    state["round"] = "preflop"
    state["handNumber"] += 1
    state["winnerIds"] = []
    state["status"] = "playing"
    for p in _active_players(state):
        p["hole"] = [state["deck"].pop(), state["deck"].pop()]
    state["dealerIndex"] = 0 if state["handNumber"] == 1 else (state["dealerIndex"] + 1) % len(state["players"])
    order = _seat_order(state)
    sb_player = state["players"][order[0] if len(order) > 2 else order[1]]
    bb_player = state["players"][order[1] if len(order) > 2 else order[0]]
    _post_blind(state, sb_player, SMALL_BLIND)
    _post_blind(state, bb_player, BIG_BLIND)
    state["minRaise"] = BIG_BLIND
    preflop_first = order[2] if len(order) > 2 else order[1]
    state["currentPlayerIndex"] = _next_active_index(state, (preflop_first - 1 + len(state["players"])) % len(state["players"]))
    state["lastAction"] = "发牌完成，盲注已下"
    return state


# ---------- 动作 ----------
def legal_poker_actions(state, player_id):
    player = state["players"][state["currentPlayerIndex"]] if state["currentPlayerIndex"] >= 0 else None
    if not player or player["id"] != player_id or player["status"] != "active" or state["status"] != "playing":
        return []
    to_call = state["currentBet"] - player["bet"]
    actions = [{"type": "fold"}]
    if to_call == 0:
        actions.append({"type": "check"})
    else:
        actions.append({"type": "call"})
    if player["chips"] > 0:
        if to_call == 0:
            if player["chips"] >= state["minRaise"]:
                actions.append({"type": "bet", "amount": min(player["chips"], state["currentBet"] + state["minRaise"])})
        else:
            min_raise_to = state["currentBet"] + state["minRaise"]
            if player["chips"] > to_call and player["chips"] >= min_raise_to - player["bet"]:
                actions.append({"type": "raise", "amount": min(player["chips"] + player["bet"], min_raise_to)})
        actions.append({"type": "allin"})
    return actions


def _advance_after_action(state):
    contenders = [p for p in state["players"] if p["status"] in ("active", "allin")]
    if len(contenders) == 1:
        return _finish_hand(state)
    all_matched = all(p["status"] in ("folded", "out", "allin") or p["bet"] == state["currentBet"] for p in state["players"])
    someone_committed = any(p["totalBet"] > 0 for p in state["players"])
    if all_matched and someone_committed:
        return _advance_street(state)
    nxt = _next_active_index(state, state["currentPlayerIndex"])
    if nxt < 0:
        return _finish_hand(state)
    state["currentPlayerIndex"] = nxt
    return state


def _advance_street(state):
    for p in state["players"]:
        p["bet"] = 0
    state["currentBet"] = 0
    state["minRaise"] = BIG_BLIND
    if state["round"] == "preflop":
        state["round"] = "flop"
        state["community"].extend([state["deck"].pop(), state["deck"].pop(), state["deck"].pop()])
        state["log"].append("翻牌：" + " ".join(card_label(c) for c in state["community"]))
    elif state["round"] == "flop":
        state["round"] = "turn"
        state["community"].append(state["deck"].pop())
        state["log"].append("转牌：" + card_label(state["community"][3]))
    elif state["round"] == "turn":
        state["round"] = "river"
        state["community"].append(state["deck"].pop())
        state["log"].append("河牌：" + card_label(state["community"][4]))
    else:
        return _finish_hand(state)
    if not any(p["status"] == "active" for p in state["players"]):
        while state["round"] in ("flop", "turn"):
            if state["round"] == "flop":
                state["round"] = "turn"
                state["community"].append(state["deck"].pop())
            else:
                state["round"] = "river"
                state["community"].append(state["deck"].pop())
        return _finish_hand(state)
    order = _seat_order(state)
    first = next((idx for idx in order if state["players"][idx]["status"] == "active"), None)
    state["currentPlayerIndex"] = first if first is not None else _next_active_index(state, state["dealerIndex"])
    label = {"flop": "翻牌", "turn": "转牌", "river": "河牌"}[state["round"]]
    state["lastAction"] = f"{label}开始"
    return state


def apply_poker_action(state, player_id, action):
    if state["status"] != "playing":
        raise ValueError("牌局不在进行中")
    player = state["players"][state["currentPlayerIndex"]] if state["currentPlayerIndex"] >= 0 else None
    if not player or player["id"] != player_id:
        raise ValueError("还没轮到你")
    if player["status"] != "active":
        raise ValueError("你已无法行动")
    to_call = state["currentBet"] - player["bet"]
    atype = action.get("type")

    if atype == "fold":
        player["status"] = "folded"
        state["log"].append(f"{player['name']} 弃牌")
        state["lastAction"] = f"{player['name']} 弃牌"
        return _advance_after_action(state)
    if atype == "check":
        if to_call != 0:
            raise ValueError("当前需要跟注，不能过牌")
        state["log"].append(f"{player['name']} 过牌")
        state["lastAction"] = f"{player['name']} 过牌"
        return _advance_after_action(state)
    if atype == "call":
        put = min(player["chips"], to_call)
        player["chips"] -= put
        player["bet"] += put
        player["totalBet"] += put
        state["pot"] += put
        if player["chips"] == 0:
            player["status"] = "allin"
        state["log"].append(f"{player['name']} 全下跟注 {put}" if player["status"] == "allin" else f"{player['name']} 跟注 {put}")
        state["lastAction"] = f"{player['name']} 全下" if player["status"] == "allin" else f"{player['name']} 跟注"
        return _advance_after_action(state)
    if atype in ("bet", "raise"):
        amount = int(action.get("amount") or 0)
        raise_to = amount
        is_raise = raise_to > state["currentBet"]
        if is_raise:
            min_allowed = state["currentBet"] + state["minRaise"]
            if raise_to < min_allowed and raise_to < player["chips"] + player["bet"]:
                raise ValueError("加注金额不足")
            if raise_to > player["chips"] + player["bet"]:
                raise ValueError("筹码不足")
            put = raise_to - player["bet"]
            player["chips"] -= put
            player["bet"] = raise_to
            player["totalBet"] += put
            state["pot"] += put
            state["minRaise"] = raise_to - state["currentBet"]
            state["currentBet"] = raise_to
            if player["chips"] == 0:
                player["status"] = "allin"
            state["log"].append(f"{player['name']} {'下注' if atype == 'bet' else '加注到'} {raise_to}")
            state["lastAction"] = f"{player['name']} 全下 {raise_to}" if player["status"] == "allin" else f"{player['name']} {'下注' if atype == 'bet' else '加注到'} {raise_to}"
        else:
            put = min(player["chips"], to_call)
            player["chips"] -= put
            player["bet"] += put
            player["totalBet"] += put
            state["pot"] += put
            if player["chips"] == 0:
                player["status"] = "allin"
            state["log"].append(f"{player['name']} 跟注 {put}")
        return _advance_after_action(state)
    if atype == "allin":
        put = player["chips"]
        player["bet"] += put
        player["totalBet"] += put
        state["pot"] += put
        player["chips"] = 0
        old_bet = state["currentBet"]
        player["status"] = "allin"
        if player["bet"] > state["currentBet"]:
            state["minRaise"] = player["bet"] - old_bet
            state["currentBet"] = player["bet"]
        state["log"].append(f"{player['name']} 全下 {player['bet']}")
        state["lastAction"] = f"{player['name']} 全下"
        return _advance_after_action(state)
    raise ValueError("未知操作")


# ---------- 边池与结算 ----------
def compute_side_pots(state):
    contributors = [p for p in state["players"] if p["totalBet"] > 0]
    levels = sorted({p["totalBet"] for p in contributors})
    pots = []
    prev = 0
    for level in levels:
        amount = sum(max(0, min(p["totalBet"], level) - prev) for p in contributors)
        if amount > 0:
            eligible = [p["id"] for p in contributors if p["totalBet"] >= level and p["status"] in ("allin", "active")]
            pots.append({"amount": amount, "eligible": eligible})
        prev = level
    return pots


def _finish_hand(state):
    contenders = [p for p in state["players"] if p["status"] in ("active", "allin")]
    pot_total = state["pot"]
    state["status"] = "handEnded"
    if len(contenders) == 1:
        winner = contenders[0]
        winner["chips"] += pot_total
        state["winnerIds"] = [winner["id"]]
        state["log"].append(f"{winner['name']} 赢下 {pot_total}（其余玩家弃牌）")
        return handle_rebuys(state)
    state["round"] = "showdown"
    values = {p["id"]: evaluate_best(p["hole"] + state["community"]) for p in contenders}
    side_pots = compute_side_pots(state)
    winners = []
    for pot in side_pots:
        eligible = sorted(pot["eligible"], key=lambda pid: compare_hands(values[pid], values[pot["eligible"][0]]), reverse=True)
        best_value = values[pot["eligible"][0]]
        for pid in pot["eligible"]:
            if compare_hands(values[pid], best_value) > 0:
                best_value = values[pid]
        top = [pid for pid in pot["eligible"] if compare_hands(values[pid], best_value) == 0]
        share = pot["amount"] // len(top)
        remainder = pot["amount"] - share * len(top)
        for i, pid in enumerate(top):
            player = next(p for p in state["players"] if p["id"] == pid)
            player["chips"] += share + (remainder if i == 0 else 0)
            winners.append(pid)
        names = "、".join(next(p for p in state["players"] if p["id"] == pid)["name"] for pid in top)
        state["log"].append(f"{names} 赢下 {pot['amount']}（{hand_name(best_value)}）")
    state["winnerIds"] = list(dict.fromkeys(winners))
    state["lastAction"] = "摊牌结算"
    return handle_rebuys(state)


def handle_rebuys(state):
    for p in state["players"]:
        if p["chips"] <= 0:
            p["bankruptcies"] += 1
            p["chips"] = p["startingChips"]
            p["status"] = "active"
            state["log"].append(f"{p['name']} 破产，已补筹至 {p['startingChips']}（第 {p['bankruptcies']} 次破产）")
    return state


# ---------- 观战 ----------
def add_spectator(state, name, spectator_id):
    if any(s["id"] == spectator_id for s in state["spectators"]):
        return state
    label = str(name or "")[:12] or "观众"
    state["spectators"].append({"id": spectator_id, "name": label})
    state["log"].append(f"{label} 进入观战")
    return state


def remove_spectator(state, spectator_id):
    state["spectators"] = [s for s in state["spectators"] if s["id"] != spectator_id]
    return state


# ---------- 人机 ----------
def _hand_strength(state, player):
    if state["round"] == "preflop" and len(state["community"]) == 0:
        a, b = player["hole"]
        score = (a["r"] + b["r"]) / 2
        if a["r"] == b["r"]:
            score += 8
        if a["r"] >= 14 or b["r"] >= 14:
            score += 4
        if a["r"] >= 13 or b["r"] >= 13:
            score += 2
        if a["s"] == b["s"]:
            score += 1.5
        return score
    value = evaluate_best(player["hole"] + state["community"])
    return value["category"] * 20 + (value["ranks"][0] if value["ranks"] else 0)


def choose_poker_bot_action(state):
    player = state["players"][state["currentPlayerIndex"]]
    difficulty = player.get("botDifficulty") or "normal"
    strength = _hand_strength(state, player)
    to_call = state["currentBet"] - player["bet"]
    pot = state["pot"]
    pot_odds = to_call / (pot + to_call) if to_call > 0 else 0
    r = random.random()
    thresholds = {"easy": 12, "normal": 18, "hard": 24}
    if to_call == 0:
        bet_chance = {"easy": 0.12, "normal": 0.22, "hard": 0.35}[difficulty]
        if r < bet_chance and strength > thresholds["normal"]:
            amount = min(player["chips"], state["currentBet"] + state["minRaise"])
            return {"type": "bet", "amount": amount}
        return {"type": "check"}
    threshold = thresholds[difficulty]
    bluff_chance = {"easy": 0.05, "normal": 0.1, "hard": 0.18}[difficulty]
    fold_threshold = pot_odds + {"easy": 4, "normal": 2.5, "hard": 1.2}[difficulty]
    if strength >= threshold:
        if player["chips"] <= to_call:
            return {"type": "allin"}
        raise_chance = {"easy": 0.25, "normal": 0.4, "hard": 0.6}[difficulty]
        if r < raise_chance:
            amount = min(player["chips"] + player["bet"], state["currentBet"] + state["minRaise"] * (3 if difficulty == "hard" else 2))
            if amount > state["currentBet"] and amount <= player["chips"] + player["bet"]:
                return {"type": "raise", "amount": amount}
            return {"type": "allin"}
        return {"type": "call"}
    if r < bluff_chance:
        if player["chips"] <= to_call:
            return {"type": "allin"}
        return {"type": "call"}
    if strength < fold_threshold:
        return {"type": "fold"}
    return {"type": "call"}


def run_poker_bot_turns(state):
    guard = 0
    while state["status"] == "playing" and state["players"][state["currentPlayerIndex"]].get("isBot") and guard < 200:
        guard += 1
        bot = state["players"][state["currentPlayerIndex"]]
        if bot["status"] != "active":
            break
        action = choose_poker_bot_action(state)
        apply_poker_action(state, bot["id"], action)
    return state

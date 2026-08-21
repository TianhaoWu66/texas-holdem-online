# -*- coding: utf-8 -*-
"""德州扑克 Python 引擎测试（对应 TS 引擎 9 项测试）。"""
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)

import poker as p

passed = 0
failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"PASS  {name}")
    else:
        failed += 1
        print(f"FAIL  {name}  {extra}")


def C(r, s):
    return {"r": r, "s": s}


# 1) 牌型判定
check("同花顺", p.evaluate5([C(14,0),C(13,0),C(12,0),C(11,0),C(10,0)])["category"] == 8)
low = p.evaluate5([C(14,0),C(2,1),C(3,2),C(4,3),C(5,0)])
check("低顺 A2345", low["category"] == 4 and low["ranks"][0] == 5)
check("四条", p.evaluate5([C(9,0),C(9,1),C(9,2),C(9,3),C(5,0)])["category"] == 7)
check("葫芦", p.evaluate5([C(7,0),C(7,1),C(7,2),C(5,3),C(5,0)])["category"] == 6)
check("同花", p.evaluate5([C(14,1),C(11,1),C(9,1),C(6,1),C(3,1)])["category"] == 5)
check("顺子", p.evaluate5([C(9,0),C(8,1),C(7,2),C(6,3),C(5,0)])["category"] == 4)
check("三条", p.evaluate5([C(4,0),C(4,1),C(4,2),C(8,3),C(2,0)])["category"] == 3)
check("两对", p.evaluate5([C(10,0),C(10,1),C(3,2),C(3,3),C(8,0)])["category"] == 2)
check("一对", p.evaluate5([C(12,0),C(12,1),C(7,2),C(4,3),C(2,0)])["category"] == 1)
check("高牌", p.evaluate5([C(13,0),C(11,1),C(9,2),C(6,3),C(3,0)])["category"] == 0)

# 2) 7 张最佳 + 比较
h1 = p.evaluate_best([C(14,0),C(13,0),C(12,0),C(11,0),C(10,0),C(9,1),C(2,2)])
h2 = p.evaluate_best([C(14,1),C(13,1),C(12,1),C(11,1),C(10,1),C(9,2),C(2,3)])
check("同花顺相等", p.compare_hands(h1, h2) == 0)
pair = p.evaluate_best([C(14,0),C(14,1),C(12,2),C(11,3),C(10,0),C(9,1),C(2,2)])
check("同花顺 > 一对", p.compare_hands(h1, pair) > 0)
six = p.evaluate_best([C(14,0),C(14,1),C(12,2),C(11,3),C(10,0),C(9,1)])
check("6 张（转牌）", six["category"] == 1)

# 3) 大厅与开局
s = p.create_poker_lobby("A", 3, "t1")
p.add_poker_player(s, "B", "t2")
p.add_poker_player(s, "C", "t3")
p.start_hand(s)
check("开局状态", s["status"] == "playing" and s["round"] == "preflop")
check("每人两张底牌", all(len(pl["hole"]) == 2 for pl in s["players"]))
check("盲注 SB/BB", s["players"][1]["totalBet"] == 10 and s["players"][2]["totalBet"] == 20)
check("底池 30", s["pot"] == 30 and s["currentBet"] == 20)

# 4) 完整跟注到摊牌 + 守恒
s = p.create_poker_lobby("A", 3, "t1")
p.add_poker_player(s, "B", "t2")
p.add_poker_player(s, "C", "t3")
total_before = sum(x["chips"] for x in s["players"])
p.start_hand(s)
guard = 0
while s["status"] == "playing" and guard < 300:
    guard += 1
    player = s["players"][s["currentPlayerIndex"]]
    if player["status"] != "active":
        break
    to_call = s["currentBet"] - player["bet"]
    p.apply_poker_action(s, player["id"], {"type": "check"} if to_call == 0 else {"type": "call"})
check("跟注到摊牌", s["status"] == "handEnded")
total_after = sum(x["chips"] for x in s["players"])
check("筹码守恒", total_after == total_before)

# 5) 边池计算
s = p.create_poker_lobby("A", 3, "t1")
p.add_poker_player(s, "B", "t2")
p.add_poker_player(s, "C", "t3")
s["players"][0]["totalBet"] = 500; s["players"][0]["status"] = "allin"
s["players"][1]["totalBet"] = 500; s["players"][1]["status"] = "active"
s["players"][2]["totalBet"] = 200; s["players"][2]["status"] = "allin"
pots = p.compute_side_pots(s)
check("边池数量", len(pots) == 2)
check("主池 600", pots[0]["amount"] == 600 and len(pots[0]["eligible"]) == 3)
check("边池 600", pots[1]["amount"] == 600 and len(pots[1]["eligible"]) == 2)

# 6) 全下不同筹码守恒（含补筹）
s = p.create_poker_lobby("A", 3, "t1")
p.add_poker_player(s, "B", "t2")
p.add_poker_player(s, "C", "t3")
s["players"][0]["chips"] = 500
s["players"][1]["chips"] = 500
s["players"][2]["chips"] = 200
total_before = sum(x["chips"] for x in s["players"])
p.start_hand(s)
guard = 0
while s["status"] == "playing" and guard < 300:
    guard += 1
    player = s["players"][s["currentPlayerIndex"]]
    if player["status"] != "active":
        break
    p.apply_poker_action(s, player["id"], {"type": "allin"})
check("全下结束", s["status"] == "handEnded")
total_after = sum(x["chips"] for x in s["players"])
busts = sum(x["bankruptcies"] for x in s["players"])
check("含补筹守恒", total_after == total_before + p.STARTING_CHIPS * busts)
check("全员有筹码", all(x["chips"] > 0 for x in s["players"]))

# 7) 破产补筹
s = p.create_poker_lobby("A", 2, "t1")
p.add_poker_player(s, "B", "t2")
s["players"][1]["chips"] = 0
s["status"] = "handEnded"
p.handle_rebuys(s)
check("补筹", s["players"][1]["chips"] == p.STARTING_CHIPS)
check("破产次数", s["players"][1]["bankruptcies"] == 1)

# 8) 观战
s = p.create_poker_lobby("A", 2, "t1")
p.add_poker_player(s, "B", "t2")
p.add_spectator(s, "观众一号", "spec1")
p.add_spectator(s, "观众二号", "spec2")
check("观战加入", len(s["spectators"]) == 2)
p.remove_spectator(s, "spec1")
check("观战退出", len(s["spectators"]) == 1)

# 9) 人机 30 手
s = p.create_poker_lobby("A", 5, "t1")
p.add_poker_bot(s, "easy")
p.add_poker_bot(s, "normal")
p.add_poker_bot(s, "hard")
p.add_poker_bot(s, "normal")
s["players"][0]["isBot"] = True
s["players"][0]["botDifficulty"] = "normal"
ok = True
for _ in range(30):
    p.start_hand(s)
    guard = 0
    while s["status"] == "playing" and guard < 500:
        guard += 1
        p.run_poker_bot_turns(s)
    if s["status"] != "handEnded":
        ok = False
        break
check("人机 30 手完成", ok)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)

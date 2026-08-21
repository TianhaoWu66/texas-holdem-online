// 德州扑克核心引擎（TypeScript）
export type Suit = 0 | 1 | 2 | 3; // 0=♠ 1=♥ 2=♦ 3=♣
export type Card = { r: number; s: Suit }; // r: 2..14（11 J, 12 Q, 13 K, 14 A）
export type BotDifficulty = "easy" | "normal" | "hard";

export type PokerPlayer = {
  id: string;
  token?: string;
  name: string;
  color: string;
  avatar?: string;
  accountId?: string;
  chips: number;
  startingChips: number;
  bankruptcies: number;
  hole: Card[];
  bet: number;
  totalBet: number;
  status: "active" | "folded" | "allin" | "out";
  acted: boolean;
  isBot?: boolean;
  botDifficulty?: BotDifficulty;
};

export type PokerAction =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  | { type: "bet"; amount: number }
  | { type: "raise"; amount: number }
  | { type: "allin" };

export type BettingRound = "preflop" | "flop" | "turn" | "river" | "showdown";

export type PokerGameState = {
  status: "lobby" | "playing" | "handEnded" | "finished";
  maxPlayers: number;
  hostId: string;
  players: PokerPlayer[];
  spectators: { id: string; name: string }[];
  deck: Card[];
  community: Card[];
  pot: number;
  currentBet: number;
  dealerIndex: number;
  currentPlayerIndex: number;
  round: BettingRound;
  handNumber: number;
  minRaise: number;
  lastAction: string;
  log: string[];
  winnerIds: string[];
};

export const PLAYER_COLORS = ["#e6a23c", "#df6b57", "#5f9b76", "#5f7dad", "#8b6bb1", "#c98a3d"];
export const STARTING_CHIPS = 1000;
export const SMALL_BLIND = 10;
export const BIG_BLIND = 20;
export const SUIT_SYMBOLS = ["♠", "♥", "♦", "♣"];
export const RANK_LABELS: Record<number, string> = { 2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A" };

export function cardLabel(card: Card): string {
  return `${RANK_LABELS[card.r]}${SUIT_SYMBOLS[card.s]}`;
}

function shuffle<T>(values: T[]): T[] {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (let s = 0 as Suit; s < 4; s++) {
    for (let r = 2; r <= 14; r++) deck.push({ r, s });
  }
  return deck;
}

// ---------- 牌型判定 ----------
// category: 8=同花顺 7=四条 6=葫芦 5=同花 4=顺子 3=三条 2=两对 1=一对 0=高牌
export type HandValue = { category: number; ranks: number[] };

export function evaluate5(cards: Card[]): HandValue {
  const ranks = cards.map((c) => c.r).sort((a, b) => b - a);
  const suits = cards.map((c) => c.s);
  const isFlush = suits.every((s) => s === suits[0]);
  const uniq = [...new Set(ranks)];
  const isStraight = uniq.length === 5 && (ranks[0] - ranks[4] === 4 || (ranks[0] === 14 && ranks[1] === 5 && ranks[4] === 2));
  let straightHigh = isStraight ? (ranks[0] === 14 && ranks[1] === 5 ? 5 : ranks[0]) : 0;
  if (isFlush && isStraight) return { category: 8, ranks: [straightHigh] };
  // 统计点数出现次数
  const counts = new Map<number, number>();
  ranks.forEach((r) => counts.set(r, (counts.get(r) ?? 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const [g0, g1] = groups;
  if (g0[1] === 4) return { category: 7, ranks: [g0[0], groups[1][0]] };
  if (g0[1] === 3 && g1 && g1[1] === 2) return { category: 6, ranks: [g0[0], g1[0]] };
  if (isFlush) return { category: 5, ranks };
  if (isStraight) return { category: 4, ranks: [straightHigh] };
  if (g0[1] === 3) return { category: 3, ranks: [g0[0], ...groups.slice(1).map((g) => g[0])] };
  if (g0[1] === 2 && g1 && g1[1] === 2) return { category: 2, ranks: [g0[0], g1[0], groups[2][0]] };
  if (g0[1] === 2) return { category: 1, ranks: [g0[0], ...groups.slice(1).map((g) => g[0])] };
  return { category: 0, ranks };
}

/** 从任意张牌（≥5）中选出 5 张最佳 */
export function evaluateBest(cards: Card[]): HandValue {
  if (cards.length < 5) return { category: 0, ranks: cards.map((c) => c.r).sort((a, b) => b - a) };
  if (cards.length === 5) return evaluate5(cards);
  const n = cards.length;
  let best: HandValue | null = null;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            const value = evaluate5(five);
            if (!best || compareHands(value, best) > 0) best = value;
          }
  return best!;
}

export function compareHands(a: HandValue, b: HandValue): number {
  if (a.category !== b.category) return a.category - b.category;
  for (let i = 0; i < a.ranks.length; i++) {
    if ((a.ranks[i] ?? 0) !== (b.ranks[i] ?? 0)) return (a.ranks[i] ?? 0) - (b.ranks[i] ?? 0);
  }
  return 0;
}

export function handName(value: HandValue): string {
  const names = ["高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺"];
  return names[value.category];
}

// ---------- 大厅 ----------
export function createPokerLobby(hostName: string, maxPlayers: number, token: string, profile?: { accountId?: string; avatar?: string }): PokerGameState {
  const profileSafe = profile ?? {};
  const host: PokerPlayer = {
    id: crypto.randomUUID(), token, name: hostName, color: PLAYER_COLORS[0],
    avatar: profileSafe.avatar, accountId: profileSafe.accountId,
    chips: STARTING_CHIPS, startingChips: STARTING_CHIPS, bankruptcies: 0,
    hole: [], bet: 0, totalBet: 0, status: "active", acted: false,
  };
  return {
    status: "lobby", maxPlayers, hostId: host.id, players: [host], spectators: [],
    deck: [], community: [], pot: 0, currentBet: 0, dealerIndex: 0, currentPlayerIndex: 0,
    round: "preflop", handNumber: 0, minRaise: BIG_BLIND, lastAction: "", log: [`${hostName} 创建了牌局`],
    winnerIds: [],
  };
}

export function addPokerPlayer(state: PokerGameState, name: string, token: string, profile?: { accountId?: string; avatar?: string }): PokerGameState {
  if (state.status !== "lobby") throw new Error("牌局已经开始");
  if (state.players.length >= state.maxPlayers) throw new Error("座位已满");
  if (state.players.some((p) => p.name === name)) throw new Error("这个昵称已被使用");
  const profileSafe = profile ?? {};
  state.players.push({
    id: crypto.randomUUID(), token, name, color: PLAYER_COLORS[state.players.length],
    avatar: profileSafe.avatar, accountId: profileSafe.accountId,
    chips: STARTING_CHIPS, startingChips: STARTING_CHIPS, bankruptcies: 0,
    hole: [], bet: 0, totalBet: 0, status: "active", acted: false,
  });
  state.log.push(`${name} 加入了牌局`);
  return state;
}

const BOT_NAMES: Record<BotDifficulty, string[]> = {
  easy: ["新手赌徒", "菜鸟", "小跟注"],
  normal: ["河牌高手", "诈唬者", "紧手玩家"],
  hard: ["德州宗师", "赌神", "冷面杀手"],
};

export function addPokerBot(state: PokerGameState, difficulty: BotDifficulty): PokerGameState {
  if (state.status !== "lobby") throw new Error("牌局已经开始");
  if (state.players.length >= state.maxPlayers) throw new Error("座位已满");
  if (!(difficulty in BOT_NAMES)) throw new Error("人机难度无效");
  const used = new Set(state.players.map((p) => p.name));
  let name = BOT_NAMES[difficulty].find((n) => !used.has(n)) ?? BOT_NAMES[difficulty][0];
  let suffix = 2;
  while (used.has(name)) name = `${BOT_NAMES[difficulty][0]}${suffix++}`;
  state.players.push({
    id: crypto.randomUUID(), name, color: PLAYER_COLORS[state.players.length], avatar: "🤖",
    chips: STARTING_CHIPS, startingChips: STARTING_CHIPS, bankruptcies: 0,
    hole: [], bet: 0, totalBet: 0, status: "active", acted: false, isBot: true, botDifficulty: difficulty,
  });
  state.log.push(`${name}（人机）加入了牌局`);
  return state;
}

export function removePokerBot(state: PokerGameState, botId: string): PokerGameState {
  if (state.status !== "lobby") throw new Error("牌局已经开始");
  const index = state.players.findIndex((p) => p.id === botId && p.isBot);
  if (index < 0) throw new Error("找不到这个人机玩家");
  const [bot] = state.players.splice(index, 1);
  state.players.forEach((p, i) => { p.color = PLAYER_COLORS[i]; });
  state.log.push(`${bot.name} 离开了牌局`);
  return state;
}

// ---------- 开牌 ----------
function activePlayers(state: PokerGameState): PokerPlayer[] {
  return state.players.filter((p) => p.status === "active" || p.status === "allin");
}

function postBlind(state: PokerGameState, player: PokerPlayer, amount: number) {
  const put = Math.min(player.chips, amount);
  player.chips -= put;
  player.bet += put;
  player.totalBet += put;
  state.pot += put;
  state.currentBet = Math.max(state.currentBet, player.bet);
  if (player.chips === 0) player.status = "allin";
  state.log.push(`${player.name} 下盲注 ${put}`);
}

export function startHand(state: PokerGameState): PokerGameState {
  if (state.status !== "handEnded" && state.status !== "lobby") throw new Error("当前不能开局");
  const seated = state.players.filter((p) => p.chips > 0);
  if (seated.length < 2) throw new Error("至少需要两名有筹码的玩家");
  // 重置状态
  state.players.forEach((p) => {
    p.hole = []; p.bet = 0; p.totalBet = 0;
    p.status = p.chips > 0 ? "active" : "out";
    p.acted = false;
  });
  state.deck = shuffle(fullDeck());
  state.community = [];
  state.pot = 0;
  state.currentBet = 0;
  state.minRaise = BIG_BLIND;
  state.round = "preflop";
  state.handNumber += 1;
  state.winnerIds = [];
  state.status = "playing";
  // 发底牌
  activePlayers(state).forEach((p) => {
    p.hole = [state.deck.pop()!, state.deck.pop()!];
  });
  // 庄家/盲注位置
  if (state.handNumber === 1) {
    state.dealerIndex = 0;
  } else {
    state.dealerIndex = (state.dealerIndex + 1) % state.players.length;
  }
  const order = seatOrder(state);
  const sbPlayer = state.players[order.length > 2 ? order[0] : order[1]];
  const bbPlayer = state.players[order.length > 2 ? order[1] : order[0]];
  postBlind(state, sbPlayer, SMALL_BLIND);
  postBlind(state, bbPlayer, BIG_BLIND);
  state.minRaise = BIG_BLIND;
  // 翻牌前第一个行动：大盲左手边（UTG）；单挑时小盲（庄家）先行动
  const preflopFirst = order.length > 2 ? order[2] : order[1];
  state.currentPlayerIndex = nextActiveIndex(state, (preflopFirst - 1 + state.players.length) % state.players.length);
  state.lastAction = "发牌完成，盲注已下";
  return state;
}

function seatOrder(state: PokerGameState): number[] {
  // 从庄家左手边开始（庄家之后）
  const n = state.players.length;
  const order: number[] = [];
  for (let step = 1; step <= n; step++) order.push((state.dealerIndex + step) % n);
  return order;
}

function nextActiveIndex(state: PokerGameState, from: number): number {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (from + step) % n;
    const p = state.players[idx];
    if (p.status === "active") return idx;
  }
  return -1;
}

// ---------- 动作 ----------
export function legalPokerActions(state: PokerGameState, playerId: string): PokerAction[] {
  const player = state.players[state.currentPlayerIndex];
  if (!player || player.id !== playerId || player.status !== "active" || state.status !== "playing") return [];
  const toCall = state.currentBet - player.bet;
  const actions: PokerAction[] = [];
  actions.push({ type: "fold" });
  if (toCall === 0) {
    actions.push({ type: "check" });
  } else {
    actions.push({ type: "call" });
  }
  if (player.chips > 0) {
    if (toCall === 0) {
      if (player.chips >= state.minRaise) actions.push({ type: "bet", amount: Math.min(player.chips, state.currentBet + state.minRaise) });
    } else {
      const minRaiseTo = state.currentBet + state.minRaise;
      if (player.chips > toCall && player.chips >= minRaiseTo - player.bet) actions.push({ type: "raise", amount: Math.min(player.chips + player.bet, minRaiseTo) });
    }
    actions.push({ type: "allin" });
  }
  return actions;
}

export function applyPokerAction(state: PokerGameState, playerId: string, action: PokerAction): PokerGameState {
  if (state.status !== "playing") throw new Error("牌局不在进行中");
  const player = state.players[state.currentPlayerIndex];
  if (!player || player.id !== playerId) throw new Error("还没轮到你");
  if (player.status !== "active") throw new Error("你已无法行动");
  const toCall = state.currentBet - player.bet;

  if (action.type === "fold") {
    player.status = "folded";
    player.acted = true;
    state.log.push(`${player.name} 弃牌`);
    state.lastAction = `${player.name} 弃牌`;
    return advanceAfterAction(state);
  }
  if (action.type === "check") {
    if (toCall !== 0) throw new Error("当前需要跟注，不能过牌");
    player.acted = true;
    state.log.push(`${player.name} 过牌`);
    state.lastAction = `${player.name} 过牌`;
    return advanceAfterAction(state);
  }
  if (action.type === "call") {
    player.acted = true;
    const put = Math.min(player.chips, toCall);
    player.chips -= put;
    player.bet += put;
    player.totalBet += put;
    state.pot += put;
    if (player.chips === 0) player.status = "allin";
    state.log.push(player.status === "allin" ? `${player.name} 全下跟注 ${put}` : `${player.name} 跟注 ${put}`);
    state.lastAction = player.status === "allin" ? `${player.name} 全下` : `${player.name} 跟注`;
    return advanceAfterAction(state);
  }
  if (action.type === "bet" || action.type === "raise") {
    let amount = Math.floor(action.amount);
    const totalToReach = action.type === "bet" ? amount : amount;
    const isRaise = totalToReach > state.currentBet;
    player.acted = true;
    if (isRaise) {
      const raiseTo = totalToReach;
      const minAllowed = state.currentBet + state.minRaise;
      if (raiseTo < minAllowed && raiseTo < player.chips + player.bet) throw new Error("加注金额不足");
      if (raiseTo > player.chips + player.bet) throw new Error("筹码不足");
      const put = raiseTo - player.bet;
      if (put > player.chips) throw new Error("筹码不足");
      player.chips -= put;
      player.bet = raiseTo;
      player.totalBet += put;
      state.pot += put;
      state.minRaise = raiseTo - state.currentBet;
      state.currentBet = raiseTo;
      if (player.chips === 0) player.status = "allin";
      state.log.push(`${player.name} ${action.type === "bet" ? "下注" : "加注到"} ${raiseTo}`);
      state.lastAction = player.status === "allin" ? `${player.name} 全下 ${raiseTo}` : `${player.name} ${action.type === "bet" ? "下注" : "加注到"} ${raiseTo}`;
    } else {
      // bet 到等于 currentBet = call
      const put = Math.min(player.chips, toCall);
      player.chips -= put;
      player.bet += put;
      player.totalBet += put;
      state.pot += put;
      if (player.chips === 0) player.status = "allin";
      state.log.push(`${player.name} 跟注 ${put}`);
    }
    return advanceAfterAction(state);
  }
  if (action.type === "allin") {
    player.acted = true;
    const put = player.chips;
    player.bet += put;
    player.totalBet += put;
    state.pot += put;
    player.chips = 0;
    const oldBet = state.currentBet;
    player.status = "allin";
    if (player.bet > state.currentBet) {
      state.minRaise = player.bet - oldBet;
      state.currentBet = player.bet;
    }
    state.log.push(`${player.name} 全下 ${player.bet}`);
    state.lastAction = `${player.name} 全下`;
    return advanceAfterAction(state);
  }
  throw new Error("未知操作");
}

function advanceAfterAction(state: PokerGameState): PokerGameState {
  // 是否只剩一名未弃牌玩家 → 直接结束
  const contenders = state.players.filter((p) => p.status === "active" || p.status === "allin");
  if (contenders.length === 1) {
    return finishHand(state);
  }
  // 是否所有 active 玩家都已跟注到 currentBet（且至少有一人下过注或全下）
  const allMatched = state.players.every((p) => p.status === "folded" || p.status === "out" || p.status === "allin" || (p.acted && p.bet === state.currentBet));
  const someoneCommitted = state.players.some((p) => p.totalBet > 0);
  if (allMatched && someoneCommitted) {
    return advanceStreet(state);
  }
  const next = nextActiveIndex(state, state.currentPlayerIndex);
  if (next < 0) return finishHand(state);
  state.currentPlayerIndex = next;
  return state;
}

function advanceStreet(state: PokerGameState): PokerGameState {
  // 重置本轮下注
  state.players.forEach((p) => { p.bet = 0; p.acted = false; });
  state.currentBet = 0;
  state.minRaise = BIG_BLIND;
  if (state.round === "preflop") {
    state.round = "flop";
    state.community.push(state.deck.pop()!, state.deck.pop()!, state.deck.pop()!);
    state.log.push("翻牌：" + state.community.map(cardLabel).join(" "));
  } else if (state.round === "flop") {
    state.round = "turn";
    state.community.push(state.deck.pop()!);
    state.log.push("转牌：" + cardLabel(state.community[3]));
  } else if (state.round === "turn") {
    state.round = "river";
    state.community.push(state.deck.pop()!);
    state.log.push("河牌：" + cardLabel(state.community[4]));
  } else {
    return finishHand(state);
  }
  // 若已无人能行动（全部全下）→ 发完剩余公共牌并直接结算
  if (!state.players.some((p) => p.status === "active")) {
    while (state.round === "flop" || state.round === "turn") {
      if (state.round === "flop") { state.round = "turn"; state.community.push(state.deck.pop()!); }
      else { state.round = "river"; state.community.push(state.deck.pop()!); }
    }
    state.round = "river";
    return finishHand(state);
  }
  // 翻牌后从庄家左手边第一个 active 玩家开始
  const order = seatOrder(state);
  const first = order.find((idx) => state.players[idx].status === "active");
  state.currentPlayerIndex = first ?? nextActiveIndex(state, state.dealerIndex);
  state.lastAction = `${state.round === "flop" ? "翻牌" : state.round === "turn" ? "转牌" : "河牌"}开始`;
  return state;
}

// ---------- 边池与结算 ----------
export function computeSidePots(state: PokerGameState): { amount: number; eligible: string[] }[] {
  const contributors = state.players.filter((p) => p.totalBet > 0);
  const levels = [...new Set(contributors.map((p) => p.totalBet))].sort((a, b) => a - b);
  const pots: { amount: number; eligible: string[] }[] = [];
  let prev = 0;
  levels.forEach((level) => {
    const amount = contributors.reduce((sum, p) => sum + Math.max(0, Math.min(p.totalBet, level) - prev), 0);
    if (amount > 0) {
      const eligible = contributors.filter((p) => p.totalBet >= level && (p.status === "allin" || p.status === "active")).map((p) => p.id);
      pots.push({ amount, eligible });
    }
    prev = level;
  });
  return pots;
}

function finishHand(state: PokerGameState): PokerGameState {
  const contenders = state.players.filter((p) => p.status === "active" || p.status === "allin");
  const potTotal = state.pot;
  state.status = "handEnded";
  if (contenders.length === 1) {
    const winner = contenders[0];
    winner.chips += potTotal;
    state.winnerIds = [winner.id];
    state.log.push(`${winner.name} 赢下 ${potTotal}（其余玩家弃牌）`);
    return handleRebuys(state);
  }
  // 摊牌
  state.round = "showdown";
  const values = new Map<string, HandValue>();
  contenders.forEach((p) => values.set(p.id, evaluateBest([...p.hole, ...state.community])));
  const sidePots = computeSidePots(state);
  const winners: string[] = [];
  sidePots.forEach((pot) => {
    const eligibleValues = pot.eligible.map((id) => ({ id, value: values.get(id)! })).sort((a, b) => compareHands(b.value, a.value));
    const best = eligibleValues[0].value;
    const top = eligibleValues.filter((e) => compareHands(e.value, best) === 0);
    const share = Math.floor(pot.amount / top.length);
    const remainder = pot.amount - share * top.length;
    top.forEach((t, i) => {
      t && (state.players.find((p) => p.id === t.id)!.chips += share + (i === 0 ? remainder : 0));
      winners.push(t.id);
    });
    const name = top.map((t) => state.players.find((p) => p.id === t.id)!.name).join("、");
    state.log.push(`${name} 赢下 ${pot.amount}（${handName(best)}）`);
  });
  state.winnerIds = [...new Set(winners)];
  state.lastAction = "摊牌结算";
  return handleRebuys(state);
}

export function handleRebuys(state: PokerGameState): PokerGameState {
  state.players.forEach((p) => {
    if (p.chips <= 0) {
      p.bankruptcies += 1;
      p.chips = p.startingChips;
      p.status = "active";
      state.log.push(`${p.name} 破产，已补筹至 ${p.startingChips}（第 ${p.bankruptcies} 次破产）`);
    }
  });
  return state;
}

// ---------- 观战 ----------
export function addSpectator(state: PokerGameState, name: string, spectatorId: string): PokerGameState {
  if (state.spectators.some((s) => s.id === spectatorId)) return state;
  state.spectators.push({ id: spectatorId, name: String(name).slice(0, 12) || "观众" });
  state.log.push(`${String(name).slice(0, 12) || "观众"} 进入观战`);
  return state;
}

export function removeSpectator(state: PokerGameState, spectatorId: string): PokerGameState {
  state.spectators = state.spectators.filter((s) => s.id !== spectatorId);
  return state;
}

// ---------- 人机 ----------
function handStrength(state: PokerGameState, player: PokerPlayer): number {
  if (state.round === "preflop" && state.community.length === 0) {
    // 简单按底牌评估：对子/A 大牌
    const [a, b] = player.hole;
    let score = (a.r + b.r) / 2;
    if (a.r === b.r) score += 8;
    if (a.r >= 14 || b.r >= 14) score += 4;
    if (a.r >= 13 || b.r >= 13) score += 2;
    if (a.s === b.s) score += 1.5;
    return score;
  }
  const value = evaluateBest([...player.hole, ...state.community]);
  return value.category * 20 + (value.ranks[0] ?? 0);
}

export function choosePokerBotAction(state: PokerGameState): PokerAction {
  const player = state.players[state.currentPlayerIndex];
  const difficulty = player.botDifficulty ?? "normal";
  const strength = handStrength(state, player);
  const toCall = state.currentBet - player.bet;
  const pot = state.pot;
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
  const r = Math.random();

  const easyThresh = 12;
  const normalThresh = 18;
  const hardThresh = 24;

  if (toCall === 0) {
    // 可过牌或下注
    const betChance = difficulty === "easy" ? 0.12 : difficulty === "normal" ? 0.22 : 0.35;
    if (r < betChance && strength > normalThresh) {
      const amount = Math.min(player.chips, state.currentBet + state.minRaise);
      return { type: "bet", amount };
    }
    return { type: "check" };
  }

  const threshold = difficulty === "easy" ? easyThresh : difficulty === "normal" ? normalThresh : hardThresh;
  const bluffChance = difficulty === "easy" ? 0.05 : difficulty === "normal" ? 0.1 : 0.18;
  const foldThreshold = potOdds + (difficulty === "easy" ? 4 : difficulty === "normal" ? 2.5 : 1.2);

  if (strength >= threshold) {
    // 强势：加注/全下
    if (player.chips <= toCall) return { type: "allin" };
    const raiseChance = difficulty === "easy" ? 0.25 : difficulty === "normal" ? 0.4 : 0.6;
    if (r < raiseChance) {
      const amount = Math.min(player.chips + player.bet, state.currentBet + state.minRaise * (difficulty === "hard" ? 3 : 2));
      if (amount > state.currentBet && amount <= player.chips + player.bet) return { type: "raise", amount };
      return { type: "allin" };
    }
    return { type: "call" };
  }
  if (r < bluffChance) {
    if (player.chips <= toCall) return { type: "allin" };
    return { type: "call" };
  }
  if (strength < foldThreshold) return { type: "fold" };
  return { type: "call" };
}

export function runPokerBotTurns(state: PokerGameState) {
  let guard = 0;
  while (state.status === "playing" && state.players[state.currentPlayerIndex]?.isBot && guard++ < 200) {
    const bot = state.players[state.currentPlayerIndex];
    if (bot.status !== "active") break;
    const action = choosePokerBotAction(state);
    applyPokerAction(state, bot.id, action);
  }
  return state;
}

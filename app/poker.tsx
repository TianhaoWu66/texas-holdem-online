import { useCallback, useEffect, useRef, useState } from "react";
import {
  BIG_BLIND, cardLabel, Card, createPokerLobby, evaluateBest, handName,
  legalPokerActions, PokerAction, PokerGameState, RANK_LABELS, SMALL_BLIND, SUIT_SYMBOLS,
  PLAYER_COLORS, STARTING_CHIPS,
} from "../lib/poker";

type RoomResponse = { code: string; version: number; token?: string; playerId?: string; spectatorId?: string; state: PokerGameState; error?: string };
type AccountProfile = { id: string; username: string; nickname: string; avatar: string };

const CHAT_PHRASES = ["老叟戏顽童", "神之一手", "你的计谋被我识破了"];
const CHAT_AUDIO: Record<string, string> = {};

function speakChatPhrase(phrase: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const voice = new SpeechSynthesisUtterance(phrase);
  voice.lang = "zh-CN";
  voice.rate = .9;
  voice.pitch = .92;
  const chineseVoice = window.speechSynthesis.getVoices().find((candidate) => candidate.lang.toLowerCase().startsWith("zh"));
  if (chineseVoice) voice.voice = chineseVoice;
  window.speechSynthesis.speak(voice);
}

function CardView({ card, hidden }: { card: Card | null; hidden?: boolean }) {
  if (hidden || !card) return <div className={`poker-card back ${hidden ? "hidden" : ""}`}>🂠</div>;
  const red = card.s === 1 || card.s === 2;
  return <div className={`poker-card ${red ? "red" : ""}`}><span className="rank">{RANK_LABELS[card.r]}</span><span className="suit">{SUIT_SYMBOLS[card.s]}</span></div>;
}

export default function PokerGame() {
  const [serverRoom, setServerRoom] = useState<RoomResponse | null>(null);
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<"guest" | "login" | "register">("guest");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [registerNickname, setRegisterNickname] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [spectatorId, setSpectatorId] = useState("");
  const [myPlayerId, setMyPlayerId] = useState("");
  const [spectateName, setSpectateName] = useState("");
  const [betAmount, setBetAmount] = useState(BIG_BLIND);
  const [activeChat, setActiveChat] = useState<{ playerId: string; phrase: string } | null>(null);
  const observedChatId = useRef<number>(0);
  const chatPlayerId = useRef<string>("");
  // 全下摊牌逐条翻公共牌：shownCommunity=当前显示到第几张（null=全部）
  const [shownCommunity, setShownCommunity] = useState<number | null>(null);
  const prevCommunityLen = useRef<number>(0);
  const seenHandRef = useRef<number>(-1);
  const revealTimers = useRef<number[]>([]);

  const room = serverRoom;
  const me = room?.state.players.find((p) => p.id === myPlayerId);
  const isSpectator = !me && !!room && !!spectatorId && room.state.spectators.some((sp) => sp.id === spectatorId);
  const token = typeof window !== "undefined" && room?.code ? localStorage.getItem(`poker-token-${room.code}`) ?? "" : "";

  useEffect(() => {
    const hashCode = window.location.hash.slice(1).toUpperCase();
    if (hashCode.length === 6) {
      const pid = localStorage.getItem(`poker-player-${hashCode}`);
      const sid = localStorage.getItem(`poker-spectator-${hashCode}`);
      if (pid) setMyPlayerId(pid);
      if (sid) setSpectatorId(sid);
    }
  }, []);

  useEffect(() => {
    fetch("/api/auth", { cache: "no-store" }).then(async (response) => {
      const data = await response.json() as { user?: AccountProfile | null };
      if (data.user) { setAccount(data.user); setName(data.user.nickname); }
    }).catch(() => {}).finally(() => setAuthReady(true));
  }, []);

  const request = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/room", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json() as RoomResponse;
      if (!response.ok) throw new Error(data.error || "操作失败");
      setServerRoom(data);
      if (data.token) localStorage.setItem(`poker-token-${data.code}`, data.token);
      if (data.playerId) { setMyPlayerId(data.playerId); localStorage.setItem(`poker-player-${data.code}`, data.playerId); }
      if (data.spectatorId) { setSpectatorId(data.spectatorId); localStorage.setItem(`poker-spectator-${data.code}`, data.spectatorId); }
      window.history.replaceState({}, "", `#${data.code}`);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "连接失败");
      return null;
    } finally { setBusy(false); }
  }, []);

  const refresh = useCallback(async (code: string, quiet = false) => {
    try {
      const params = new URLSearchParams({ code });
      if (myPlayerId) params.set("viewerId", myPlayerId);
      if (spectatorId) params.set("spectatorId", spectatorId);
      const response = await fetch(`/api/room?${params.toString()}`, { cache: "no-store" });
      const data = await response.json() as RoomResponse;
      if (!response.ok) throw new Error(data.error || "读取房间失败");
      setServerRoom((current) => !current || data.version >= current.version ? data : current);
    } catch (e) {
      if (!quiet) setError(e instanceof Error ? e.message : "连接失败");
    }
  }, [myPlayerId, spectatorId]);

  useEffect(() => {
    const code = window.location.hash.slice(1).toUpperCase();
    if (code.length === 6) { setJoinCode(code); refresh(code, true); }
  }, [refresh]);

  useEffect(() => {
    if (!room?.code) return;
    const timer = window.setInterval(() => refresh(room.code, true), 1500);
    return () => window.clearInterval(timer);
  }, [room?.code, refresh]);

  useEffect(() => {
    if (room && me && room.state.status === "playing" && current?.id === me.id) {
      setBetAmount(Math.min(me.chips + me.bet, room.state.currentBet + room.state.minRaise));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.state.status, room?.state.currentPlayerIndex, room?.state.currentBet, room?.state.minRaise]);

  // 语音
  useEffect(() => {
    if (!room?.state) return;
    const events = room.state.chatEvents ?? [];
    const latest = events.at(-1)?.id ?? 0;
    if (chatPlayerId.current !== room.code) { chatPlayerId.current = room.code; observedChatId.current = latest; return; }
    const fresh = events.filter((e) => e.id > observedChatId.current);
    observedChatId.current = latest;
    if (fresh.length) {
      const last = fresh[fresh.length - 1];
      setActiveChat(last);
      const audioUrl = CHAT_AUDIO[last.phrase];
      if (audioUrl) new Audio(audioUrl).play().catch(() => speakChatPhrase(last.phrase));
      else speakChatPhrase(last.phrase);
      window.setTimeout(() => setActiveChat(null), 2600);
    }
  }, [room?.code, room?.state]);

  // 全下摊牌：公共牌逐条翻（先 3 张，再 1，再 1），最后再亮结果
  useEffect(() => {
    if (!room?.state) return;
    const cur = room.state.community.length;
    const prev = prevCommunityLen.current;
    const hand = room.state.handNumber;
    const wasWatching = seenHandRef.current === hand;
    seenHandRef.current = hand;
    prevCommunityLen.current = cur;
    if (cur === prev) return;
    const clearTimers = () => { revealTimers.current.forEach((t) => window.clearTimeout(t)); revealTimers.current = []; };
    if (wasWatching && cur > prev && cur - prev >= 2 && room.state.status === "handEnded") {
      clearTimers();
      setShownCommunity(Math.min(3, cur));
      revealTimers.current.push(window.setTimeout(() => setShownCommunity((v) => (v === null ? null : Math.min(4, cur))), 900));
      revealTimers.current.push(window.setTimeout(() => setShownCommunity(cur), 1800));
    } else {
      clearTimers();
      setShownCommunity(null);
    }
  }, [room]);

  useEffect(() => () => { revealTimers.current.forEach((t) => window.clearTimeout(t)); }, []);

  const accountRequest = async (action: "register" | "login" | "logout", avatar?: string) => {
    setAuthBusy(true); setAuthError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, username, password, nickname: registerNickname, avatar }),
      });
      const data = await response.json() as { user?: AccountProfile | null; error?: string };
      if (!response.ok) throw new Error(data.error || "账号操作失败");
      setAccount(data.user ?? null);
      if (data.user) { setName(data.user.nickname); setPassword(""); setAuthMode("guest"); }
    } catch (e) { setAuthError(e instanceof Error ? e.message : "账号操作失败"); }
    finally { setAuthBusy(false); }
  };

  const sendAction = async (action: PokerAction) => {
    if (!room) return;
    await request({ command: "action", code: room.code, token, action });
  };

  const exitGame = () => {
    window.location.hash = "";
    setServerRoom(null);
    setSpectatorId("");
    setMyPlayerId("");
  };

  const current = room?.state.players[room?.state.currentPlayerIndex ?? -1];
  const legal = room && me ? legalPokerActions(room.state, me.id) : [];
  const canAct = !!room && !!me && room.state.status === "playing" && current?.id === me.id && legal.length > 0;
  const isBotTurn = !!room && room.state.status === "playing" && !!current?.isBot;
  const toCall = room && me ? Math.max(0, room.state.currentBet - me.bet) : 0;
  const minRaiseTo = room ? room.state.currentBet + room.state.minRaise : BIG_BLIND;
  const isHost = !!room && !!me && me.id === room.state.hostId;

  // 环桌座位
  const totalPlayers = room?.state.players.length ?? 0;
  const myIndex = room && me ? room.state.players.findIndex((p) => p.id === me.id) : -1;
  const seatSlot = (index: number): string | null => {
    if (myIndex < 0) return "slot-top";
    const seat = (index - myIndex + totalPlayers) % totalPlayers;
    if (seat === 0) return null;
    const slots = [["slot-top"], ["slot-top-left", "slot-top-right"], ["slot-top-left", "slot-top", "slot-top-right"], ["slot-left", "slot-top-left", "slot-top", "slot-top-right"], ["slot-left", "slot-top-left", "slot-top", "slot-top-right", "slot-right"]];
    const list = slots[totalPlayers - 2] ?? [];
    return list[seat - 1] ?? "slot-top";
  };

  if (!room || (!me && !isSpectator)) {
    return <main className="landing-shell">
      <div className="brand-mark">🂠</div>
      <section className="landing-copy">
        <p className="eyebrow">在线德州扑克</p>
        <h1>德州风云</h1>
        <p>无限注德州扑克 · 边池结算 · 破产补筹 · 观战</p>
        <div className="rule-pills"><span>2–6 人</span><span>无限注</span><span>支持人机</span></div>
      </section>
      <section className="entry-card">
        {!account && <div className="auth-tabs" role="tablist">
          {(["guest", "login", "register"] as const).map((mode) => <button role="tab" aria-selected={authMode === mode} className={authMode === mode ? "active" : ""} key={mode} onClick={() => { setAuthMode(mode); setAuthError(""); }}>{mode === "guest" ? "游客" : mode === "login" ? "账号登录" : "注册"}</button>)}
        </div>}
        {authReady && account && <div className="account-card"><b>{account.nickname}</b><button className="account-logout" disabled={authBusy} onClick={() => accountRequest("logout")}>退出</button></div>}
        {authReady && !account && authMode === "login" && <div className="auth-form">
          <label>账号<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="用户名" /></label>
          <label>密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="密码" /></label>
          <button className="primary wide" disabled={authBusy || !username.trim() || !password} onClick={() => accountRequest("login")}>登录</button>
        </div>}
        {authReady && !account && authMode === "register" && <div className="auth-form">
          <label>账号<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="3–24 位字母数字下划线" /></label>
          <label>密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="至少 6 位" /></label>
          <label>昵称<input value={registerNickname} onChange={(e) => setRegisterNickname(e.target.value)} placeholder="游戏中显示的名字" /></label>
          <button className="primary wide" disabled={authBusy || !username.trim() || password.length < 6 || !registerNickname.trim()} onClick={() => accountRequest("register")}>注册并登录</button>
        </div>}
        {authReady && (account || authMode === "guest") && <div className="game-entry-fields">
          {!account && <label>玩家昵称<input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} placeholder="牌桌昵称" /></label>}
          <div className="create-row">
            <label>人数<select value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))}>{[2, 3, 4, 5, 6].map((n) => <option value={n} key={n}>{n} 人</option>)}</select></label>
            <button className="primary" disabled={busy || !name.trim()} onClick={() => request({ command: "create", name, maxPlayers })}>创建牌桌</button>
          </div>
          <div className="divider"><span>或加入朋友</span></div>
          <div className="join-row">
            <input aria-label="房间码" value={joinCode} maxLength={6} onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="六位房间码" />
            <button disabled={busy || !name.trim() || joinCode.length !== 6} onClick={() => request({ command: "join", name, code: joinCode })}>加入</button>
          </div>
          <div className="divider"><span>或观战</span></div>
          <div className="join-row">
            <input aria-label="观战房间码" value={spectateName} maxLength={12} onChange={(e) => setSpectateName(e.target.value)} placeholder="观众昵称（可选）" />
            <button disabled={busy || joinCode.length !== 6} onClick={() => request({ command: "spectate", name: spectateName || "观众", code: joinCode })}>观战</button>
          </div>
        </div>}
        {authError && <div className="error-box">{authError}</div>}
        {error && <div className="error-box">{error}</div>}
      </section>
    </main>;
  }

  const state = room.state;
  const community = state.community;
  const isHandEnded = state.status === "handEnded";
  const shown = shownCommunity ?? community.length;
  const revealing = shown < community.length;

  return <main className={`game-shell ${isSpectator ? "spectator" : ""}`}>
    <header className="game-header">
      <div className="wordmark">🂠 德州风云</div>
      <div className="round-info"><span>第 {state.handNumber} 手</span><b>{revealing ? "摊牌中…" : isHandEnded ? "本手结束" : state.status === "lobby" ? "等待开局" : canAct ? "轮到你行动" : isBotTurn ? `${current?.name} 🤖 思考中…` : state.lastAction}</b>{isSpectator && <em>观战中</em>}</div>
      <div className="header-actions"><button className="room-code mini" onClick={() => navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}#${room.code}`).then(() => setError("已复制邀请链接"))}><small>房间</small>{room.code}<span>复制</span></button></div>
    </header>

    <section className="table">
      {/* 公共牌 + 底池 */}
      <div className="board-center">
        <div className="pot-display"><span>底池</span><b>{state.pot}</b></div>
        <div className="community-row">
          {[0, 1, 2, 3, 4].map((i) => <CardView key={i} card={i >= shown ? null : community[i] ?? null} />)}
        </div>
        {state.round === "showdown" && <div className="showdown-label">摊牌</div>}
      </div>

      {/* 座位 */}
      <div className="seats-layer">
        {state.players.map((p, index) => {
          const slot = seatSlot(index);
          if (!slot) return null;
          const isCurrent = index === state.currentPlayerIndex && state.status === "playing";
          const isDealer = index === state.dealerIndex;
          return <div className={`player-seat ${slot} ${isCurrent ? "active" : ""}`} key={p.id}>
            <div className="poker-strip">
              <span className="avatar" style={{ background: p.color }}>{p.avatar ?? p.name.slice(0, 1)}</span>
              <div className="player-meta"><b>{p.name}{p.isBot && <small> · 人机</small>}</b><span className="chip-count">{p.chips}</span></div>
              <div className="hole-cards">{(revealing ? [] : p.hole).map((c, i) => <CardView key={i} card={c} />)}</div>
              {p.bankruptcies > 0 && <span className="bust-badge" title={`破产 ${p.bankruptcies} 次`}>💥{p.bankruptcies}</span>}
            </div>
            <div className="seat-badges">
              {isDealer && <span className="dealer-chip">D</span>}
              {p.bet > 0 && <span className="bet-chip">{p.bet}</span>}
              {p.status === "folded" && <span className="folded-chip">弃牌</span>}
              {p.status === "allin" && <span className="allin-chip">全下</span>}
              {activeChat?.playerId === p.id && <span className="speech-chip">{activeChat.phrase}</span>}
              {isCurrent && p.isBot && <span className="thinking-badge">🤖 思考中</span>}
            </div>
          </div>;
        })}
      </div>


    </section>

      {/* 我的手牌区（底部） */}
      {me && <section className="me-area">
        <div className="me-strip">
          <span className="avatar" style={{ background: me.color }}>{me.avatar ?? me.name.slice(0, 1)}</span>
          <div className="player-meta"><b>{me.name}{isHost && <small> 房主</small>}</b><span className="chip-count">筹码 {me.chips}</span>{me.bankruptcies > 0 && <span className="bust-badge">💥破产 {me.bankruptcies} 次</span>}</div>
          <div className="my-hole">{me.hole.map((c, i) => <CardView key={i} card={c} />)}</div>
        </div>
        <div className="action-bar">
          {state.status === "lobby" && <>
            {isHost && <div className="bot-add"><span>添加人机</span><button className="act" disabled={busy} onClick={() => request({ command: "addBot", code: room.code, token, difficulty: "easy" })}>简单</button><button className="act" disabled={busy} onClick={() => request({ command: "addBot", code: room.code, token, difficulty: "normal" })}>普通</button><button className="act" disabled={busy} onClick={() => request({ command: "addBot", code: room.code, token, difficulty: "hard" })}>困难</button></div>}
            {isHost && <button className="primary" disabled={busy || room.state.players.length < 2} onClick={() => request({ command: "start", code: room.code, token })}>开始发牌</button>}
            {!isHost && <div className="spectator-note">等待房主发牌…</div>}
          </>}
          {state.status === "playing" && <>
            <button className="act" disabled={!canAct} onClick={() => sendAction({ type: "fold" })}>弃牌</button>
            <button className="act" disabled={!canAct || !legal.some((a) => a.type === "check")} onClick={() => sendAction({ type: "check" })}>过牌</button>
            <button className="act" disabled={!canAct || toCall === 0} onClick={() => sendAction({ type: "call" })}>跟注 {toCall}</button>
            <button className="act" disabled={!canAct || !legal.some((a) => a.type === "bet" || a.type === "raise")} onClick={() => sendAction({ type: "bet", amount: betAmount })}>{toCall === 0 ? "下注" : "加注"} {betAmount}</button>
            <div className="bet-stepper">
              <button disabled={!canAct} onClick={() => setBetAmount((v) => Math.max(room.state.currentBet + room.state.minRaise, Math.floor(v / 2)))}>−</button>
              <b>{betAmount}</b>
              <button disabled={!canAct} onClick={() => setBetAmount((v) => Math.min(me.chips + me.bet, Math.ceil(v * 2)))}>＋</button>
              <button className="mini" disabled={!canAct} onClick={() => setBetAmount(Math.min(me.chips + me.bet, room.state.currentBet + room.state.minRaise * 3))}>3×</button>
              <button className="mini" disabled={!canAct} onClick={() => sendAction({ type: "allin" })}>全下</button>
            </div>
          </>}
          {state.status === "handEnded" && !revealing && <>
            <div className="result-line">{state.winnerIds.length > 0 ? state.winnerIds.map((id) => state.players.find((p) => p.id === id)?.name).join("、") : "—"} 赢得本手</div>
            {isHost && <button className="primary" disabled={busy} onClick={() => request({ command: "start", code: room.code, token })}>下一手</button>}
          </>}
          {isSpectator && <div className="spectator-note">👁 观战模式：仅能看到公共牌与筹码</div>}
          {!isSpectator && <div className="quick-chat">{CHAT_PHRASES.map((phrase) => <button key={phrase} disabled={busy} onClick={() => request({ command: "chat", code: room.code, token, phrase })}>🔊{phrase}</button>)}</div>}
        </div>
        {error && <div className="toast" onClick={() => setError("")}>{error}</div>}
      </section>}
  </main>;
}

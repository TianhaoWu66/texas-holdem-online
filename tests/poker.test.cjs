const { test } = require("node:test");
const assert = require("node:assert");
const p = require("./out/poker.cjs");

const C = (r, s) => ({ r, s });

test("牌型判定", () => {
  assert.equal(p.evaluate5([C(14,0),C(13,0),C(12,0),C(11,0),C(10,0)]).category, 8);
  const lowStraight = p.evaluate5([C(14,0),C(2,1),C(3,2),C(4,3),C(5,0)]);
  assert.equal(lowStraight.category, 4);
  assert.equal(lowStraight.ranks[0], 5);
  assert.equal(p.evaluate5([C(9,0),C(9,1),C(9,2),C(9,3),C(5,0)]).category, 7);
  assert.equal(p.evaluate5([C(7,0),C(7,1),C(7,2),C(5,3),C(5,0)]).category, 6);
  assert.equal(p.evaluate5([C(14,1),C(11,1),C(9,1),C(6,1),C(3,1)]).category, 5);
  assert.equal(p.evaluate5([C(9,0),C(8,1),C(7,2),C(6,3),C(5,0)]).category, 4);
  assert.equal(p.evaluate5([C(4,0),C(4,1),C(4,2),C(8,3),C(2,0)]).category, 3);
  assert.equal(p.evaluate5([C(10,0),C(10,1),C(3,2),C(3,3),C(8,0)]).category, 2);
  assert.equal(p.evaluate5([C(12,0),C(12,1),C(7,2),C(4,3),C(2,0)]).category, 1);
  assert.equal(p.evaluate5([C(13,0),C(11,1),C(9,2),C(6,3),C(3,0)]).category, 0);
});

test("7 张最佳牌与比较", () => {
  const h1 = p.evaluateBest([C(14,0),C(13,0),C(12,0),C(11,0),C(10,0),C(9,1),C(2,2)]);
  const h2 = p.evaluateBest([C(14,1),C(13,1),C(12,1),C(11,1),C(10,1),C(9,2),C(2,3)]);
  assert.equal(p.compareHands(h1, h2), 0);
  const pair = p.evaluateBest([C(14,0),C(14,1),C(12,2),C(11,3),C(10,0),C(9,1),C(2,2)]);
  assert.ok(p.compareHands(h1, pair) > 0);
  // 6 张（转牌时 2 底牌+4 公共牌）
  const six = p.evaluateBest([C(14,0),C(14,1),C(12,2),C(11,3),C(10,0),C(9,1)]);
  assert.equal(six.category, 1);
});

test("大厅与开局", () => {
  let s = p.createPokerLobby("A", 3, "t1");
  p.addPokerPlayer(s, "B", "t2");
  p.addPokerPlayer(s, "C", "t3");
  p.startHand(s);
  assert.equal(s.status, "playing");
  assert.equal(s.round, "preflop");
  s.players.forEach((pl) => assert.equal(pl.hole.length, 2));
  assert.equal(s.players[1].totalBet, 10);
  assert.equal(s.players[2].totalBet, 20);
  assert.equal(s.currentBet, 20);
  assert.equal(s.pot, 30);
});

test("完整跟注流程到摊牌 + 筹码守恒", () => {
  let s = p.createPokerLobby("A", 3, "t1");
  p.addPokerPlayer(s, "B", "t2");
  p.addPokerPlayer(s, "C", "t3");
  const totalBefore = s.players.reduce((sum, x) => sum + x.chips, 0);
  p.startHand(s);
  let guard = 0;
  while (s.status === "playing" && guard++ < 300) {
    const player = s.players[s.currentPlayerIndex];
    if (player.status !== "active") break;
    const toCall = s.currentBet - player.bet;
    p.applyPokerAction(s, player.id, toCall === 0 ? { type: "check" } : { type: "call" });
  }
  assert.equal(s.status, "handEnded");
  const totalAfter = s.players.reduce((sum, x) => sum + x.chips, 0);
  assert.equal(totalAfter, totalBefore);
});

test("边池计算", () => {
  let s = p.createPokerLobby("A", 3, "t1");
  p.addPokerPlayer(s, "B", "t2");
  p.addPokerPlayer(s, "C", "t3");
  s.players[0].totalBet = 500; s.players[0].status = "allin";
  s.players[1].totalBet = 500; s.players[1].status = "active";
  s.players[2].totalBet = 200; s.players[2].status = "allin";
  const pots = p.computeSidePots(s);
  assert.equal(pots.length, 2);
  assert.equal(pots[0].amount, 600);
  assert.equal(pots[0].eligible.length, 3);
  assert.equal(pots[1].amount, 600);
  assert.equal(pots[1].eligible.length, 2);
});

test("全下不同筹码守恒（含补筹）", () => {
  let s = p.createPokerLobby("A", 3, "t1");
  p.addPokerPlayer(s, "B", "t2");
  p.addPokerPlayer(s, "C", "t3");
  s.players[0].chips = 500;
  s.players[1].chips = 500;
  s.players[2].chips = 200;
  const totalBefore = s.players.reduce((sum, x) => sum + x.chips, 0);
  p.startHand(s);
  let guard = 0;
  while (s.status === "playing" && guard++ < 300) {
    const player = s.players[s.currentPlayerIndex];
    if (player.status !== "active") break;
    p.applyPokerAction(s, player.id, { type: "allin" });
  }
  assert.equal(s.status, "handEnded");
  const totalAfter = s.players.reduce((sum, x) => sum + x.chips, 0);
  const bankruptcies = s.players.reduce((sum, x) => sum + x.bankruptcies, 0);
  assert.equal(totalAfter, totalBefore + p.STARTING_CHIPS * bankruptcies);
  assert.ok(s.players.every((x) => x.chips > 0));
});

test("破产补筹并记录次数", () => {
  let s = p.createPokerLobby("A", 2, "t1");
  p.addPokerPlayer(s, "B", "t2");
  s.players[1].chips = 0;
  s.status = "handEnded";
  s = p.handleRebuys(s);
  assert.equal(s.players[1].chips, p.STARTING_CHIPS);
  assert.equal(s.players[1].bankruptcies, 1);
});

test("观战", () => {
  let s = p.createPokerLobby("A", 2, "t1");
  p.addPokerPlayer(s, "B", "t2");
  p.addSpectator(s, "观众一号", "spec1");
  p.addSpectator(s, "观众二号", "spec2");
  assert.equal(s.spectators.length, 2);
  p.removeSpectator(s, "spec1");
  assert.equal(s.spectators.length, 1);
});

test("人机全自动对局 30 手可完成", () => {
  let s = p.createPokerLobby("A", 5, "t1");
  p.addPokerBot(s, "easy");
  p.addPokerBot(s, "normal");
  p.addPokerBot(s, "hard");
  p.addPokerBot(s, "normal");
  s.players[0].isBot = true;
  s.players[0].botDifficulty = "normal";
  for (let hand = 0; hand < 30; hand++) {
    p.startHand(s);
    let guard = 0;
    while (s.status === "playing" && guard++ < 500) p.runPokerBotTurns(s);
    assert.equal(s.status, "handEnded");
  }
});

// 热点联机（WebRTC 点对点，无服务器、断网可用）
import QRCode from "qrcode";
import type { ChatPhrase, GameAction, GameState } from "./game";

export type HotspotMessage =
  | { type: "hello"; name: string }
  | { type: "action"; action: GameAction }
  | { type: "chat"; phrase: ChatPhrase }
  | { type: "welcome"; playerId: string; code: string; name: string; color: string; avatar?: string }
  | { type: "state"; state: GameState; version: number }
  | { type: "error"; message: string };

export function parseMessage(data: string): HotspotMessage {
  return JSON.parse(data) as HotspotMessage;
}

// ---- SDP 压缩 / 解压（SDP 很长，压成短码 / 二维码）----
const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(code: string): Uint8Array {
  const base64 = code.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function compressText(text: string): Promise<string> {
  try {
    const stream = new Blob([encoder.encode(text)]).stream().pipeThrough(new CompressionStream("deflate"));
    const buf = await new Response(stream).arrayBuffer();
    return "z" + toBase64Url(new Uint8Array(buf));
  } catch {
    return "b" + btoa(unescape(encodeURIComponent(text)));
  }
}

export async function decompressText(code: string): Promise<string> {
  if (code.startsWith("z")) {
    const stream = new Blob([fromBase64Url(code.slice(1))]).stream().pipeThrough(new DecompressionStream("deflate"));
    return await new Response(stream).text();
  }
  return decodeURIComponent(escape(atob(code.startsWith("b") ? code.slice(1) : code)));
}

// ---- WebRTC ----
function waitIceComplete(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const onState = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", onState);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", onState);
    setTimeout(resolve, 2500);
  });
}

/** 房主：生成邀请码（房主把自己的 offer 发出去） */
export async function createHostPairing(): Promise<{
  offerCode: string;
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
}> {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const channel = pc.createDataChannel("game", { ordered: true });
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIceComplete(pc);
  return { offerCode: await compressText(JSON.stringify(pc.localDescription)), pc, channel };
}

/** 房主：输入玩家的应答码，完成配对 */
export async function acceptHostAnswer(pc: RTCPeerConnection, answerCode: string): Promise<void> {
  const desc = JSON.parse(await decompressText(answerCode)) as RTCSessionDescriptionInit;
  await pc.setRemoteDescription(desc);
}

/** 玩家：输入房主邀请码，生成自己的应答码，等待通道建立 */
export async function joinHost(offerCode: string): Promise<{
  answerCode: string;
  pc: RTCPeerConnection;
  channel: Promise<RTCDataChannel>;
}> {
  const offer = JSON.parse(await decompressText(offerCode)) as RTCSessionDescriptionInit;
  const pc = new RTCPeerConnection({ iceServers: [] });
  const channel = new Promise<RTCDataChannel>((resolve) => {
    pc.ondatachannel = (event) => resolve(event.channel);
  });
  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitIceComplete(pc);
  return { answerCode: await compressText(JSON.stringify(pc.localDescription)), pc, channel };
}

/** 二维码图片（dataURL） */
export async function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { width: 220, margin: 1, errorCorrectionLevel: "M" });
}

/** 广播给玩家的状态：隐藏其他玩家的手牌，保证公平 */
export function redactState(state: GameState, viewerId: string): GameState {
  return {
    ...state,
    players: state.players.map((p) => {
      if (p.id === viewerId) return { ...p };
      const copy: Record<string, unknown> = { ...p };
      delete copy.hand;
      delete copy.played;
      delete copy.token;
      delete copy.accountId;
      return copy as typeof p;
    }),
  };
}

import { Platform } from 'react-native';
import nacl from 'tweetnacl';
import {
  decodeBase64,
  encodeBase64,
  textToBytes,
} from './encoding';
import { resolveIdentityUsername } from './crypto';
import type {
  DirectoryProfile,
  LocalIdentity,
  PublicIdentity,
} from './types';

const NOSTR_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.nostr.band',
];

const DIR_TAG = 'p2p-messenger-dir-v2';

type SignedProfileContent = {
  kind: 'profile';
  signPublic: string;
  boxPublic: string;
  displayName: string;
  username: string;
  updatedAt: number;
  signature: string;
};

type SignedKnockContent = {
  kind: 'knock';
  targetSignPublic: string;
  sender: {
    signPublic: string;
    boxPublic: string;
    displayName: string;
    username: string;
  };
  timestamp: number;
  signature: string;
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
  return new Uint8Array(digest);
}

async function sha256Hex(text: string): Promise<string> {
  return bytesToHex(await sha256Bytes(textToBytes(text)));
}

function signProfilePayload(identity: LocalIdentity): SignedProfileContent {
  const username = resolveIdentityUsername(identity);
  const updatedAt = Date.now();
  const payloadText = [
    'p2p-dir-profile:v2',
    identity.signPublic,
    identity.boxPublic,
    identity.displayName,
    username,
    String(updatedAt),
  ].join('\n');
  const signature = encodeBase64(
    nacl.sign.detached(textToBytes(payloadText), decodeBase64(identity.signSecret)),
  );
  return {
    kind: 'profile',
    signPublic: identity.signPublic,
    boxPublic: identity.boxPublic,
    displayName: identity.displayName,
    username,
    updatedAt,
    signature,
  };
}

function verifyProfilePayload(raw: unknown): DirectoryProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (
    p.kind !== 'profile' ||
    typeof p.signPublic !== 'string' ||
    typeof p.boxPublic !== 'string' ||
    typeof p.displayName !== 'string' ||
    typeof p.username !== 'string' ||
    typeof p.updatedAt !== 'number' ||
    typeof p.signature !== 'string'
  ) {
    return null;
  }
  try {
    const pubBytes = decodeBase64(p.signPublic);
    const boxBytes = decodeBase64(p.boxPublic);
    const sigBytes = decodeBase64(p.signature);
    if (pubBytes.length !== 32 || boxBytes.length !== 32 || sigBytes.length !== 64) {
      return null;
    }
    const payloadText = [
      'p2p-dir-profile:v2',
      p.signPublic,
      p.boxPublic,
      p.displayName,
      p.username,
      String(p.updatedAt),
    ].join('\n');
    const ok = nacl.sign.detached.verify(textToBytes(payloadText), sigBytes, pubBytes);
    if (!ok) return null;

    return {
      signPublic: p.signPublic,
      boxPublic: p.boxPublic,
      displayName: p.displayName.trim().slice(0, 48) || 'Peer',
      username: resolveIdentityUsername({
        displayName: p.displayName,
        signPublic: p.signPublic,
        username: p.username,
      }),
      updatedAt: p.updatedAt,
      lastSeenAt: p.updatedAt,
    };
  } catch {
    return null;
  }
}

function signKnockPayload(identity: LocalIdentity, targetSignPublic: string): SignedKnockContent {
  const username = resolveIdentityUsername(identity);
  const timestamp = Date.now();
  const payloadText = [
    'p2p-dir-knock:v2',
    targetSignPublic,
    identity.signPublic,
    identity.boxPublic,
    identity.displayName,
    username,
    String(timestamp),
  ].join('\n');
  const signature = encodeBase64(
    nacl.sign.detached(textToBytes(payloadText), decodeBase64(identity.signSecret)),
  );
  return {
    kind: 'knock',
    targetSignPublic,
    sender: {
      signPublic: identity.signPublic,
      boxPublic: identity.boxPublic,
      displayName: identity.displayName,
      username,
    },
    timestamp,
    signature,
  };
}

function verifyKnockPayload(raw: unknown, mySignPublic: string): PublicIdentity | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (
    p.kind !== 'knock' ||
    p.targetSignPublic !== mySignPublic ||
    typeof p.timestamp !== 'number' ||
    typeof p.signature !== 'string' ||
    !p.sender ||
    typeof p.sender !== 'object'
  ) {
    return null;
  }
  const s = p.sender as Record<string, unknown>;
  if (
    typeof s.signPublic !== 'string' ||
    typeof s.boxPublic !== 'string' ||
    typeof s.displayName !== 'string' ||
    typeof s.username !== 'string'
  ) {
    return null;
  }
  try {
    const pubBytes = decodeBase64(s.signPublic);
    const boxBytes = decodeBase64(s.boxPublic);
    const sigBytes = decodeBase64(p.signature);
    if (pubBytes.length !== 32 || boxBytes.length !== 32 || sigBytes.length !== 64) {
      return null;
    }
    const payloadText = [
      'p2p-dir-knock:v2',
      mySignPublic,
      s.signPublic,
      s.boxPublic,
      s.displayName,
      s.username,
      String(p.timestamp),
    ].join('\n');
    const ok = nacl.sign.detached.verify(textToBytes(payloadText), sigBytes, pubBytes);
    if (!ok) return null;

    return {
      signPublic: s.signPublic,
      boxPublic: s.boxPublic,
      displayName: s.displayName.trim().slice(0, 48) || 'New contact',
      username: resolveIdentityUsername({
        displayName: s.displayName,
        signPublic: s.signPublic,
        username: s.username,
      }),
    };
  } catch {
    return null;
  }
}

// Pure BigInt BIP-340 Schnorr signing over secp256k1 (zero external dependencies)
const SECP_P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn;
const SECP_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const SECP_GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n;
const SECP_GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n;
type Pt = [bigint, bigint] | null;

function mod(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}
function powMod(base: bigint, exp: bigint, m: bigint): bigint {
  let res = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) res = mod(res * b, m);
    b = mod(b * b, m);
    e >>= 1n;
  }
  return res;
}
function invMod(a: bigint, m: bigint): bigint {
  return powMod(a, m - 2n, m);
}
function ptAdd(p1: Pt, p2: Pt): Pt {
  if (!p1) return p2;
  if (!p2) return p1;
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  if (x1 === x2 && y1 !== y2) return null;
  const lam = x1 === x2
    ? mod(3n * x1 * x1 * invMod(2n * y1, SECP_P), SECP_P)
    : mod((y2 - y1) * invMod(x2 - x1, SECP_P), SECP_P);
  const x3 = mod(lam * lam - x1 - x2, SECP_P);
  const y3 = mod(lam * (x1 - x3) - y1, SECP_P);
  return [x3, y3];
}
function ptMul(k: bigint, pt: Pt = [SECP_GX, SECP_GY]): Pt {
  let res: Pt = null;
  let cur: Pt = pt;
  let n = mod(k, SECP_N);
  while (n > 0n) {
    if (n & 1n) res = ptAdd(res, cur);
    cur = ptAdd(cur, cur);
    n >>= 1n;
  }
  return res;
}
function bytesToBigInt(b: Uint8Array): bigint {
  return BigInt("0x" + bytesToHex(b));
}
function bigIntToBytes32(n: bigint): Uint8Array {
  const hex = mod(n, SECP_N).toString(16).padStart(64, "0");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
async function taggedHash(tag: string, msg: Uint8Array): Promise<Uint8Array> {
  const tagHash = await sha256Bytes(textToBytes(tag));
  const combined = new Uint8Array(64 + msg.length);
  combined.set(tagHash, 0);
  combined.set(tagHash, 32);
  combined.set(msg, 64);
  return sha256Bytes(combined);
}
async function schnorrSignHex(msgHex32: string, privBytes32: Uint8Array): Promise<{ pubkey: string; sig: string }> {
  const d0 = bytesToBigInt(privBytes32);
  const P = ptMul(d0)!;
  const d = (P[1] & 1n) === 0n ? d0 : SECP_N - d0;
  const pxBytes = bigIntToBytes32(P[0]);
  const aux = nacl.randomBytes(32);
  const tHash = await taggedHash("BIP0340/aux", aux);
  const dBytes = bigIntToBytes32(d);
  const t = new Uint8Array(32);
  for (let i = 0; i < 32; i++) t[i] = dBytes[i] ^ tHash[i];
  const msgBytes = hexToBytes(msgHex32);
  const nonceInput = new Uint8Array(96);
  nonceInput.set(t, 0);
  nonceInput.set(pxBytes, 32);
  nonceInput.set(msgBytes, 64);
  const k0 = mod(bytesToBigInt(await taggedHash("BIP0340/nonce", nonceInput)), SECP_N);
  const R = ptMul(k0)!;
  const k = (R[1] & 1n) === 0n ? k0 : SECP_N - k0;
  const rxBytes = bigIntToBytes32(R[0]);
  const chalInput = new Uint8Array(96);
  chalInput.set(rxBytes, 0);
  chalInput.set(pxBytes, 32);
  chalInput.set(msgBytes, 64);
  const e = mod(bytesToBigInt(await taggedHash("BIP0340/challenge", chalInput)), SECP_N);
  const sBytes = bigIntToBytes32(mod(k + e * d, SECP_N));
  const sigBytes = new Uint8Array(64);
  sigBytes.set(rxBytes, 0);
  sigBytes.set(sBytes, 32);
  return { pubkey: bytesToHex(pxBytes), sig: bytesToHex(sigBytes) };
}

async function buildSignedNostrEvent(
  identity: LocalIdentity,
  dTag: string,
  extraTags: string[][],
  contentObj: unknown,
): Promise<Record<string, unknown>> {
  const privKey = await sha256Bytes(textToBytes(`nostr-transport-v1:${identity.signSecret}`));
  const d0 = bytesToBigInt(privKey);
  const P = ptMul(d0)!;
  const pubkey = bytesToHex(bigIntToBytes32(P[0]));
  const created_at = Math.floor(Date.now() / 1000);
  const kind = 30078;
  const tags = [["d", dTag], ["t", DIR_TAG], ...extraTags];
  const content = JSON.stringify(contentObj);
  const serialized = JSON.stringify([0, pubkey, created_at, kind, tags, content]);
  const id = await sha256Hex(serialized);
  const { sig } = await schnorrSignHex(id, privKey);
  return { id, pubkey, created_at, kind, tags, content, sig };
}

export interface DirectoryCallbacks {
  onProfilesUpdated(profiles: DirectoryProfile[]): void;
  onIncomingKnock(sender: PublicIdentity): void;
}

export class UsernameDirectory {
  private profiles = new Map<string, DirectoryProfile>();
  private sockets = new Map<string, WebSocket>();
  private announceTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(
    private identity: LocalIdentity,
    private readonly callbacks: DirectoryCallbacks,
  ) {}

  updateIdentity(nextIdentity: LocalIdentity): void {
    this.identity = nextIdentity;
    void this.broadcastProfile();
  }

  getProfiles(): DirectoryProfile[] {
    return Array.from(this.profiles.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  }

  private handleRelayMessage(rawData: string): void {
    try {
      const msg = JSON.parse(rawData) as unknown[];
      if (!Array.isArray(msg) || msg[0] !== 'EVENT' || !msg[2]) return;
      const ev = msg[2] as { content?: string };
      if (typeof ev.content !== 'string') return;
      const parsed = JSON.parse(ev.content) as { kind?: string };

      if (parsed.kind === 'profile') {
        const verified = verifyProfilePayload(parsed);
        if (!verified || verified.signPublic === this.identity.signPublic) return;
        const existing = this.profiles.get(verified.signPublic);
        if (!existing || verified.updatedAt >= existing.updatedAt) {
          this.profiles.set(verified.signPublic, verified);
          this.callbacks.onProfilesUpdated(this.getProfiles());
        }
      } else if (parsed.kind === 'knock') {
        const sender = verifyKnockPayload(parsed, this.identity.signPublic);
        if (sender && sender.signPublic !== this.identity.signPublic) {
          this.callbacks.onIncomingKnock(sender);
        }
      }
    } catch {
      // Ignore malformed relay frames
    }
  }

  private connectRelay(url: string): void {
    if (this.stopped || typeof WebSocket === 'undefined') return;
    try {
      const ws = new WebSocket(url);
      this.sockets.set(url, ws);

      ws.onopen = () => {
        if (this.stopped) {
          ws.close();
          return;
        }
        const subId = `dir-${Math.random().toString(36).slice(2, 8)}`;
        const since = Math.floor(Date.now() / 1000) - 86400 * 30;
        ws.send(
          JSON.stringify([
            'REQ',
            subId,
            { kinds: [30078], '#t': [DIR_TAG], since, limit: 300 },
          ]),
        );
        void this.publishProfileToSocket(ws);
      };

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          this.handleRelayMessage(event.data);
        }
      };

      ws.onclose = () => {
        if (this.sockets.get(url) === ws) {
          this.sockets.delete(url);
        }
        if (!this.stopped) {
          setTimeout(() => this.connectRelay(url), 5000);
        }
      };

      ws.onerror = () => {
        // Handled by onclose reconnect
      };
    } catch {
      // Ignore socket creation errors
    }
  }

  private async publishProfileToSocket(ws: WebSocket): Promise<void> {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      const profile = signProfilePayload(this.identity);
      const event = await buildSignedNostrEvent(
        this.identity,
        `profile:${this.identity.signPublic}`,
        [['u', profile.username]],
        profile,
      );
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(['EVENT', event]));
      }
    } catch {
      // Ignore signing errors
    }
  }

  async start(): Promise<void> {
    this.stopped = false;
    if (Platform.OS !== 'web') return;

    for (const url of NOSTR_RELAYS) {
      this.connectRelay(url);
    }

    if (this.announceTimer) clearInterval(this.announceTimer);
    this.announceTimer = setInterval(() => {
      if (!this.stopped) {
        void this.broadcastProfile();
      }
    }, 25_000);
  }

  async broadcastProfile(): Promise<void> {
    if (this.stopped) return;
    for (const ws of this.sockets.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        await this.publishProfileToSocket(ws);
      }
    }
  }

  queryRelays(searchQuery?: string): void {
    if (this.stopped) return;
    const clean = (searchQuery ?? '').trim().replace(/^@+/, '').toLowerCase();
    const subId = `q-${Math.random().toString(36).slice(2, 8)}`;
    const since = Math.floor(Date.now() / 1000) - 86400 * 30;
    const broadFilter: Record<string, unknown> = {
      kinds: [30078],
      '#t': [DIR_TAG],
      since,
      limit: 300,
    };

    for (const ws of this.sockets.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        if (clean.length >= 2) {
          ws.send(
            JSON.stringify([
              'REQ',
              subId,
              { kinds: [30078], '#u': [clean], limit: 25 },
              broadFilter,
            ]),
          );
        } else {
          ws.send(JSON.stringify(['REQ', subId, broadFilter]));
        }
      }
    }
    void this.broadcastProfile();
  }

  async sendKnock(targetSignPublic: string): Promise<void> {
    if (this.stopped) return;
    try {
      const knock = signKnockPayload(this.identity, targetSignPublic);
      const event = await buildSignedNostrEvent(
        this.identity,
        `knock:${this.identity.signPublic}:${targetSignPublic}`,
        [['p', targetSignPublic]],
        knock,
      );
      for (const ws of this.sockets.values()) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(['EVENT', event]));
        }
      }
    } catch {
      // Ignore knock errors
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.announceTimer) {
      clearInterval(this.announceTimer);
      this.announceTimer = null;
    }
    for (const ws of this.sockets.values()) {
      try {
        ws.close();
      } catch {}
    }
    this.sockets.clear();
  }
}

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

const DIRECTORY_APP_ID = 'org.p2pmessenger.directory.v1';
const DIRECTORY_ROOM = 'global-username-directory-v1';

const NOSTR_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.wine',
  'wss://relay.nostr.band',
];

type SignedProfilePacket = {
  kind: 'profile';
  signPublic: string;
  boxPublic: string;
  displayName: string;
  username: string;
  updatedAt: number;
  signature: string;
};

type SignedKnockPacket = {
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

type DirectoryWirePacket = SignedProfilePacket | SignedKnockPacket;

function signProfile(identity: LocalIdentity): SignedProfilePacket {
  const username = resolveIdentityUsername(identity);
  const updatedAt = Date.now();
  const payloadText = [
    'p2p-dir-profile:v1',
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

function verifyProfile(packet: unknown): DirectoryProfile | null {
  if (!packet || typeof packet !== 'object') return null;
  const p = packet as Record<string, unknown>;
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
      'p2p-dir-profile:v1',
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
      lastSeenAt: Date.now(),
    };
  } catch {
    return null;
  }
}

function signKnock(identity: LocalIdentity, targetSignPublic: string): SignedKnockPacket {
  const username = resolveIdentityUsername(identity);
  const timestamp = Date.now();
  const payloadText = [
    'p2p-dir-knock:v1',
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

function verifyKnock(packet: unknown, mySignPublic: string): PublicIdentity | null {
  if (!packet || typeof packet !== 'object') return null;
  const p = packet as Record<string, unknown>;
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
      'p2p-dir-knock:v1',
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

export interface DirectoryCallbacks {
  onProfilesUpdated(profiles: DirectoryProfile[]): void;
  onIncomingKnock(sender: PublicIdentity): void;
}

export class UsernameDirectory {
  private profiles = new Map<string, DirectoryProfile>();
  private sendPacket: ((packet: DirectoryWirePacket, peers?: string[] | string | null) => Promise<unknown> | unknown) | null = null;
  private leaveRoom: (() => Promise<unknown> | unknown) | null = null;
  private announceTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(
    private identity: LocalIdentity,
    private readonly callbacks: DirectoryCallbacks,
  ) {}

  updateIdentity(nextIdentity: LocalIdentity): void {
    this.identity = nextIdentity;
    this.broadcastProfile();
  }

  getProfiles(): DirectoryProfile[] {
    return Array.from(this.profiles.values()).sort(
      (a, b) => b.lastSeenAt - a.lastSeenAt,
    );
  }

  async start(): Promise<void> {
    this.stopped = false;
    if (Platform.OS !== 'web') return;

    try {
      const trystero = (await import('trystero')) as unknown as {
        joinRoom: (
          config: Record<string, unknown>,
          roomId: string,
        ) => {
          makeAction: (name: string) => [
            (data: DirectoryWirePacket, targets?: string[] | string | null) => Promise<unknown> | unknown,
            (cb: (data: DirectoryWirePacket, peerId: string) => void) => void,
          ];
          onPeerJoin?: ((cb: (peerId: string) => void) => void) | ((peerId: string) => void);
          leave: () => Promise<unknown> | unknown;
        };
      };

      if (this.stopped) return;

      const room = trystero.joinRoom(
        {
          appId: DIRECTORY_APP_ID,
          relayUrls: NOSTR_RELAYS,
        },
        DIRECTORY_ROOM,
      );

      this.leaveRoom = () => room.leave();
      const [sendFn, receiveFn] = room.makeAction('dir-v1');
      this.sendPacket = sendFn;

      if (typeof receiveFn === 'function') {
        receiveFn((packet) => {
          if (this.stopped || !packet || typeof packet !== 'object') return;
          if ((packet as { kind?: string }).kind === 'profile') {
            const verified = verifyProfile(packet);
            if (!verified || verified.signPublic === this.identity.signPublic) {
              return;
            }
            const existing = this.profiles.get(verified.signPublic);
            if (!existing || verified.updatedAt >= existing.updatedAt) {
              this.profiles.set(verified.signPublic, verified);
              this.callbacks.onProfilesUpdated(this.getProfiles());
            }
          } else if ((packet as { kind?: string }).kind === 'knock') {
            const sender = verifyKnock(packet, this.identity.signPublic);
            if (sender && sender.signPublic !== this.identity.signPublic) {
              this.callbacks.onIncomingKnock(sender);
            }
          }
        });
      }

      const handleJoin = (peerId: string) => {
        if (this.stopped) return;
        this.broadcastProfile(peerId);
      };

      if (typeof room.onPeerJoin === 'function') {
        try {
          (room.onPeerJoin as (cb: (id: string) => void) => void)(handleJoin);
        } catch {
          room.onPeerJoin = handleJoin;
        }
      }

      this.broadcastProfile();
      setTimeout(() => !this.stopped && this.broadcastProfile(), 1500);
      setTimeout(() => !this.stopped && this.broadcastProfile(), 4500);

      if (this.announceTimer) clearInterval(this.announceTimer);
      this.announceTimer = setInterval(() => {
        if (!this.stopped) {
          this.broadcastProfile();
        }
      }, 18_000);
    } catch {
      // Directory discovery will retry on reconnect
    }
  }

  broadcastProfile(targetPeerId?: string): void {
    if (this.stopped || !this.sendPacket) return;
    try {
      const signed = signProfile(this.identity);
      void Promise.resolve(
        targetPeerId ? this.sendPacket(signed, targetPeerId) : this.sendPacket(signed),
      ).catch(() => undefined);
    } catch {
      // Ignore transient broadcast errors
    }
  }

  sendKnock(targetSignPublic: string): void {
    if (this.stopped || !this.sendPacket) return;
    try {
      const knock = signKnock(this.identity, targetSignPublic);
      void Promise.resolve(this.sendPacket(knock)).catch(() => undefined);
    } catch {
      // Ignore transient knock errors
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.announceTimer) {
      clearInterval(this.announceTimer);
      this.announceTimer = null;
    }
    this.sendPacket = null;
    const leave = this.leaveRoom;
    this.leaveRoom = null;
    if (leave) {
      try {
        await leave();
      } catch {
        // Ignore leave errors
      }
    }
  }
}

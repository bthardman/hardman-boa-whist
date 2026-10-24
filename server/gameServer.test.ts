// End-to-end tests of the game server: a real server on a random port, real Socket.IO clients,
// and tiny timings so games move quickly.
import { afterEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { randomUUID } from 'crypto';
import type { GameState } from '../shared/types.ts';
import type { GameRecord } from '../shared/stats.ts';
import { FAMILY_ROOM_ID, practiceRoomId } from '../shared/players.ts';
import { createGameServer, type GameServer, type GameServerOptions } from './gameServer.ts';
import { publicIdFor } from './identity.ts';

// The local stats API needs Node's built-in SQLite (Node 22+).
const localStats = await import('../stats/localServer.ts').catch(() => null);

/** Long enough for a whole game to 1 point (it can take several rounds if nobody hits their bid). */
const FULL_GAME_TIMEOUT_MS = 20_000;

const FAST: GameServerOptions = {
  lobbySeatGraceMs: 200,
  startCountdownMs: 30,
  absentAutoplayMs: 60,
  botThinkMs: 10,
  trickPauseMs: 20,
  roundSummaryMs: 50,
  practiceIdleMs: 500,
  abandonedGameMs: 250
};

type Client = {
  socket: Socket;
  token: string;
  id: string;
  state(): GameState | undefined;
  /** Waits until the latest state matches. */
  until(pred: (s: GameState) => boolean, what?: string, timeoutMs?: number): Promise<GameState>;
  /** Waits for a one-off event. */
  event<T = unknown>(name: string, timeoutMs?: number): Promise<T>;
  emit(event: string, payload?: unknown): void;
  close(): void;
};

let servers: GameServer[] = [];
let clients: Client[] = [];

afterEach(async () => {
  clients.forEach((c) => c.close());
  clients = [];
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

async function startServer(options: GameServerOptions = FAST): Promise<{ server: GameServer; url: string }> {
  const server = createGameServer(options);
  servers.push(server);
  const port = await server.listen(0);
  return { server, url: `http://localhost:${port}` };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Connects a device. With `roomId` it joins that table straight away (like the real app does). */
async function device(url: string, opts: { token?: string; roomId?: string | null } = {}): Promise<Client> {
  const token = opts.token ?? randomUUID();
  const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  let latest: GameState | undefined;
  socket.on('state_updated', (s: GameState) => (latest = s));
  await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
  const client: Client = {
    socket,
    token,
    id: publicIdFor(token),
    state: () => latest,
    async until(pred, what = 'state', timeoutMs = 3000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (latest && pred(latest)) return latest;
        await sleep(10);
      }
      throw new Error(`Timed out waiting for ${what}; last state: ${latest?.state} in ${latest?.roomId}`);
    },
    event(name, timeoutMs = 3000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${name}"`)), timeoutMs);
        socket.once(name, (data) => {
          clearTimeout(timer);
          resolve(data);
        });
      });
    },
    emit: (event, payload) => socket.emit(event, payload),
    close: () => socket.close()
  };
  clients.push(client);
  if (opts.roomId !== null) {
    client.emit('join_lobby', { roomId: opts.roomId ?? FAMILY_ROOM_ID, token });
    await client.until((s) => s.roomId === (opts.roomId ?? FAMILY_ROOM_ID), 'first state');
  }
  return client;
}

const seatedAs = (c: Client, avatar: string) =>
  c.until((s) => s.players.some((p) => p.playerId === c.id && p.selectedAvatar === avatar), `${avatar} seated`);

/**
 * Plays this device's turns automatically: a bid of 1 (or 2 if 1 is the forbidden number for the
 * last bidder), then the first card it's allowed to play.
 */
function autoPlay(c: Client) {
  c.socket.on('state_updated', (s: GameState) => {
    const me = s.players.findIndex((p) => p.playerId === c.id);
    if (me < 0 || s.currentPlayer !== me) return;
    if (s.state === 'bidding' && typeof s.players[me].bid !== 'number') {
      const others = s.players.filter((p, i) => i !== me);
      const isLast = others.every((p) => typeof p.bid === 'number');
      const total = others.reduce((sum, p) => sum + (p.bid ?? 0), 0);
      c.emit('submit_bid', { roomId: s.roomId, bid: isLast && total + 1 === 7 ? 2 : 1 });
    } else if (s.state === 'tricks' && s.currentTrick.length < s.players.length) {
      const hand = s.players[me].hand;
      const led = s.currentTrick[0]?.card.suit;
      const card = (led && hand.find((h) => h.card.suit === led)) || hand[0];
      if (card) c.emit('playCard', { roomId: s.roomId, card });
    }
  });
}

/** Two people at the family table, game dealt. */
async function familyGame(url: string) {
  const brad = await device(url);
  const rowan = await device(url);
  brad.emit('select_avatar', { roomId: FAMILY_ROOM_ID, avatarChoice: 'brad' });
  rowan.emit('select_avatar', { roomId: FAMILY_ROOM_ID, avatarChoice: 'rowan' });
  await seatedAs(brad, 'brad');
  await seatedAs(rowan, 'rowan');
  brad.emit('start_game', { roomId: FAMILY_ROOM_ID });
  await brad.until((s) => s.state === 'bidding', 'the deal');
  return { brad, rowan };
}

describe('game server', () => {
  it('survives malformed messages instead of crashing', async () => {
    const { url } = await startServer();
    const bad = await device(url, { roomId: null });
    bad.emit('get_state');
    bad.emit('join_lobby', null);
    bad.emit('playCard', 'nonsense');
    bad.emit('submit_bid', { roomId: 42, bid: { evil: true } });
    bad.emit('join_lobby', { roomId: FAMILY_ROOM_ID, token: 'x'.repeat(5000) });
    await sleep(100);
    const res = await fetch(`${url}/health`);
    expect(res.ok).toBe(true);
    const ok = await device(url);
    expect(ok.state()?.roomId).toBe(FAMILY_ROOM_ID);
  });

  it("never sends a device's secret token, and someone's public id doesn't get you their seat", async () => {
    const { url } = await startServer();
    const { brad } = await familyGame(url);
    const state = brad.state()!;
    expect(JSON.stringify(state)).not.toContain(brad.token);
    expect(state.viewerId).toBe(brad.id);

    // Using Brad's public id (seen by everyone) as a token gives a different identity entirely.
    const impostor = await device(url, { token: brad.id });
    const seen = await impostor.until((s) => s.state === 'bidding', 'impostor state');
    expect(seen.viewerId).not.toBe(brad.id);
    const bradSeat = seen.players.find((p) => p.playerId === brad.id)!;
    expect(bradSeat.hand.every((c) => c.card.suit === 'hidden')).toBe(true);
  });

  it("ignores table actions from devices that aren't at the table", async () => {
    const { url } = await startServer();
    const { brad } = await familyGame(url);
    const outsider = await device(url, { roomId: null });
    for (const event of ['cancel_game', 'reset_lobby', 'next_round', 'rematch_game', 'start_game']) {
      outsider.emit(event, { roomId: FAMILY_ROOM_ID });
    }
    outsider.emit('set_winning_score', { roomId: FAMILY_ROOM_ID, winningScore: 1 });
    outsider.emit('get_state', { roomId: FAMILY_ROOM_ID });
    await sleep(100);
    expect(outsider.state()).toBeUndefined(); // get_state only answers your own table
    brad.emit('get_state', { roomId: FAMILY_ROOM_ID });
    await sleep(50);
    expect(brad.state()?.state).toBe('bidding');
    expect(brad.state()?.winningScore).toBe(5);
  });

  it("won't let someone who hasn't picked a picture start the game", async () => {
    const { url } = await startServer();
    const brad = await device(url);
    const rowan = await device(url);
    const viewer = await device(url);
    brad.emit('select_avatar', { roomId: FAMILY_ROOM_ID, avatarChoice: 'brad' });
    rowan.emit('select_avatar', { roomId: FAMILY_ROOM_ID, avatarChoice: 'rowan' });
    await seatedAs(rowan, 'rowan');
    await seatedAs(brad, 'brad');

    const error = viewer.event<{ message: string }>('start_game_error');
    viewer.emit('start_game', { roomId: FAMILY_ROOM_ID });
    expect((await error).message).toMatch(/picture/);
    expect(brad.state()?.startCountdown).toBeUndefined();

    // A seated player can; the unseated viewer then watches the game.
    const watching = viewer.event('watching');
    brad.emit('start_game', { roomId: FAMILY_ROOM_ID });
    await watching;
    const seen = await viewer.until((s) => s.state === 'bidding', 'viewer sees the deal');
    expect(seen.players.some((p) => p.playerId === viewer.id)).toBe(false);
  });

  it('lets a latecomer watch, then join the table when the game ends', async () => {
    const { url } = await startServer();
    const { brad } = await familyGame(url);
    const late = await device(url, { roomId: null });
    const watching = late.event('watching');
    late.emit('join_lobby', { roomId: FAMILY_ROOM_ID, token: late.token });
    await watching;
    const seen = await late.until((s) => s.state === 'bidding', 'watcher view');
    expect(seen.players.every((p) => p.hand.every((c) => c.card.suit === 'hidden'))).toBe(true);
    late.emit('emote', { roomId: FAMILY_ROOM_ID, emote: 'haha' }); // watchers can't act
    late.emit('cancel_game', { roomId: FAMILY_ROOM_ID });
    await sleep(50);
    expect(brad.state()?.state).toBe('bidding');

    brad.emit('cancel_game', { roomId: FAMILY_ROOM_ID });
    await late.until((s) => s.state === 'lobby', 'game over');
    late.emit('join_lobby', { roomId: FAMILY_ROOM_ID, token: late.token }); // what the app does next
    await late.until((s) => s.players.some((p) => p.playerId === late.id), 'joined as a player');
  });

  it("moves an Away person's seat to the device that takes it over", async () => {
    const { url } = await startServer({ ...FAST, absentAutoplayMs: 5000 });
    const { brad, rowan } = await familyGame(url);
    const tablet = await device(url);
    await tablet.until((s) => s.state === 'bidding');

    const refused = tablet.event<{ message: string }>('notice');
    tablet.emit('take_seat', { roomId: FAMILY_ROOM_ID, playerId: rowan.id }); // Rowan is still connected
    expect((await refused).message).toMatch(/isn't free/);

    rowan.close();
    await brad.until((s) => !!s.players.find((p) => p.playerId === rowan.id)?.disconnected, 'Rowan away');
    tablet.emit('take_seat', { roomId: FAMILY_ROOM_ID, playerId: rowan.id });
    const mine = await tablet.until((s) => s.players.some((p) => p.playerId === tablet.id), 'seat moved');
    const seat = mine.players.find((p) => p.playerId === tablet.id)!;
    expect(seat.selectedAvatar).toBe('rowan');
    expect(seat.hand).toHaveLength(7);
    expect(seat.hand.every((c) => c.card.suit !== 'hidden')).toBe(true);

    // Rowan's old phone coming back now only watches.
    const oldPhone = await device(url, { token: rowan.token, roomId: null });
    const watching = oldPhone.event('watching');
    oldPhone.emit('join_lobby', { roomId: FAMILY_ROOM_ID, token: rowan.token });
    await watching;
  });

  it('a solo game with a computer player moves to a private table, and back afterwards', async () => {
    const { url } = await startServer();
    const brad = await device(url);
    brad.emit('select_avatar', { roomId: FAMILY_ROOM_ID, avatarChoice: 'brad' });
    await seatedAs(brad, 'brad');
    brad.emit('add_bot', { roomId: FAMILY_ROOM_ID });
    await brad.until((s) => s.players.some((p) => p.isBot), 'bot added');

    const moved = brad.event<{ roomId: string }>('room_changed');
    brad.emit('start_game', { roomId: FAMILY_ROOM_ID });
    expect((await moved).roomId).toBe(practiceRoomId(brad.id));
    await brad.until((s) => s.roomId === practiceRoomId(brad.id) && s.state === 'bidding', 'private game');

    const back = brad.event<{ roomId: string }>('room_changed');
    brad.emit('cancel_game', { roomId: practiceRoomId(brad.id) });
    expect((await back).roomId).toBe(FAMILY_ROOM_ID);
    const family = await brad.until((s) => s.roomId === FAMILY_ROOM_ID && s.state === 'lobby', 'back at the family table');
    expect(family.players.find((p) => p.playerId === brad.id)?.selectedAvatar).toBe('brad');
    expect(family.players.filter((p) => p.isBot)).toHaveLength(1);
  });

  it("can't join someone else's practice table (you're sent to the family table instead)", async () => {
    const { server, url } = await startServer();
    const brad = await device(url);
    brad.emit('select_avatar', { roomId: FAMILY_ROOM_ID, avatarChoice: 'brad' });
    await seatedAs(brad, 'brad');
    brad.emit('add_bot', { roomId: FAMILY_ROOM_ID });
    await brad.until((s) => s.players.some((p) => p.isBot));
    brad.emit('start_game', { roomId: FAMILY_ROOM_ID });
    await brad.until((s) => s.roomId === practiceRoomId(brad.id) && s.state === 'bidding', 'private game');

    const other = await device(url, { roomId: null });
    const redirected = other.event<{ roomId: string }>('room_changed');
    other.emit('join_lobby', { roomId: practiceRoomId(brad.id), token: other.token });
    expect((await redirected).roomId).toBe(FAMILY_ROOM_ID);
    await other.until((s) => s.roomId === FAMILY_ROOM_ID, 'family table');
    expect(server.ctx.rooms.getRoom(practiceRoomId(brad.id))!.players.some((p) => p.playerId === other.id)).toBe(false);

    // Any other made-up table name is refused outright.
    const error = other.event<{ message: string }>('join_error');
    other.emit('join_lobby', { roomId: 'secret-room', token: other.token });
    expect((await error).message).toMatch(/isn't available/);
  });

  it('frees the family table when everyone has left a game', async () => {
    const { url } = await startServer();
    const { brad, rowan } = await familyGame(url);
    brad.close();
    rowan.close();
    await sleep(FAST.abandonedGameMs! + 200);
    const newcomer = await device(url);
    const state = await newcomer.until((s) => s.state === 'lobby', 'lobby after abandonment');
    expect(state.players.map((p) => p.playerId)).toEqual([newcomer.id]);
  });

  it("doesn't deal a rematch to people who left during the winner screen", async () => {
    const { server, url } = await startServer();
    const { brad, rowan } = await familyGame(url);
    // Jump to the winner screen.
    const room = server.ctx.rooms.getRoom(FAMILY_ROOM_ID)!;
    room.state = 'winner';
    room.winner = room.players[0];
    rowan.close();
    await brad.until((s) => !!s.players.find((p) => p.playerId === rowan.id)?.disconnected, 'Rowan away');
    await sleep(FAST.lobbySeatGraceMs! + 50);
    brad.emit('add_bot', { roomId: FAMILY_ROOM_ID }); // so there are still two to play
    await brad.until((s) => s.players.some((p) => p.isBot));
    brad.emit('rematch_game', { roomId: FAMILY_ROOM_ID });
    const state = await brad.until((s) => s.state === 'bidding', 'rematch dealt');
    expect(state.players.some((p) => p.playerId === rowan.id)).toBe(false);
  });

  it('lets visitors join under a name (not a family name, not one already in use)', async () => {
    const { url } = await startServer();
    const brad = await device(url);
    const visitor = await device(url);
    const other = await device(url);

    const refused = visitor.event<{ message: string }>('avatar_selection_error');
    visitor.emit('join_as_guest', { roomId: FAMILY_ROOM_ID, name: 'brad' });
    expect((await refused).message).toMatch(/up to 16 letters/);
    const notABot = visitor.event<{ message: string }>('avatar_selection_error');
    visitor.emit('join_as_guest', { roomId: FAMILY_ROOM_ID, name: 'Player 3' });
    expect((await notABot).message).toMatch(/up to 16 letters/);

    visitor.emit('join_as_guest', { roomId: FAMILY_ROOM_ID, name: '  Sam  ' });
    const seen = await brad.until((st) => st.players.some((p) => p.guestName === 'Sam'), 'guest seated');
    expect(seen.players.find((p) => p.playerId === visitor.id)?.selectedAvatar).toBe('undefined');

    const taken = other.event<{ message: string }>('avatar_selection_error');
    other.emit('join_as_guest', { roomId: FAMILY_ROOM_ID, name: 'SAM' });
    expect((await taken).message).toMatch(/already playing as SAM/);

    // Picking a face replaces the guest name; giving up the seat clears both.
    visitor.emit('select_avatar', { roomId: FAMILY_ROOM_ID, avatarChoice: 'carol' });
    await brad.until((st) => st.players.some((p) => p.playerId === visitor.id && p.selectedAvatar === 'carol' && !p.guestName), 'now Carol');
    visitor.emit('select_avatar', { roomId: FAMILY_ROOM_ID, avatarChoice: 'undefined' });
    await brad.until((st) => st.players.some((p) => p.playerId === visitor.id && p.selectedAvatar === 'undefined' && !p.guestName), 'seat given up');
  });

  it('reports each finished family game for stats, with a guest playing', async () => {
    const records: GameRecord[] = [];
    const { url } = await startServer({ ...FAST, reportGame: (r) => records.push(r) });
    const brad = await device(url);
    const visitor = await device(url);
    brad.emit('select_avatar', { roomId: FAMILY_ROOM_ID, avatarChoice: 'brad' });
    visitor.emit('join_as_guest', { roomId: FAMILY_ROOM_ID, name: 'Sam' });
    await seatedAs(brad, 'brad');
    await brad.until((st) => st.players.some((p) => p.guestName === 'Sam'));
    brad.emit('set_winning_score', { roomId: FAMILY_ROOM_ID, winningScore: 1 });
    await brad.until((st) => st.winningScore === 1);
    autoPlay(brad);
    autoPlay(visitor);
    brad.emit('start_game', { roomId: FAMILY_ROOM_ID });
    const end = await brad.until((st) => st.state === 'winner', 'the end of the game', FULL_GAME_TIMEOUT_MS - 1000);

    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record).toMatchObject({ kind: 'family', winningScore: 1, botDifficulty: null, rounds: end.roundNumber });
    expect(record.players.map((p) => [p.key, p.kind, p.name])).toEqual([
      ['brad', 'family', 'Brad'],
      ['guest:sam', 'guest', 'Sam']
    ]);
    const winner = record.players.find((p) => p.place === 1)!;
    expect(record.winnerKey).toBe(winner.key);
    expect(winner.score).toBe(1);
    for (const p of record.players) {
      expect(p.roundsMade).toBe(p.score); // a point for every exact bid
      expect(p.bidTotal).toBeGreaterThanOrEqual(record.rounds); // everyone bid at least 1 each round
    }
  }, FULL_GAME_TIMEOUT_MS);

  it('reports a solo game against the computer as practice', async () => {
    const records: GameRecord[] = [];
    const { url } = await startServer({ ...FAST, reportGame: (r) => records.push(r) });
    const brad = await device(url);
    brad.emit('select_avatar', { roomId: FAMILY_ROOM_ID, avatarChoice: 'brad' });
    await seatedAs(brad, 'brad');
    brad.emit('add_bot', { roomId: FAMILY_ROOM_ID });
    brad.emit('set_winning_score', { roomId: FAMILY_ROOM_ID, winningScore: 1 });
    await brad.until((st) => st.winningScore === 1 && st.players.some((p) => p.isBot));
    autoPlay(brad);
    brad.emit('start_game', { roomId: FAMILY_ROOM_ID });
    await brad.until((st) => st.state === 'winner', 'the end of the practice game', FULL_GAME_TIMEOUT_MS - 1000);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: 'practice', botDifficulty: 'medium' });
    expect(records[0].players.map((p) => p.key)).toEqual(['brad', 'bot:Player 2']);
  }, FULL_GAME_TIMEOUT_MS);

  it.skipIf(!localStats)('stores finished games in the stats API and serves them back through /api/stats', async () => {
    const statsApi = await localStats!.startLocalStatsServer({ secret: 'test-secret' });
    try {
      const { url } = await startServer({ ...FAST, statsUrl: statsApi.url, statsSecret: 'test-secret' });
      const brad = await device(url);
      const rowan = await device(url);
      brad.emit('select_avatar', { roomId: FAMILY_ROOM_ID, avatarChoice: 'brad' });
      rowan.emit('select_avatar', { roomId: FAMILY_ROOM_ID, avatarChoice: 'rowan' });
      await seatedAs(brad, 'brad');
      await seatedAs(rowan, 'rowan');
      brad.emit('set_winning_score', { roomId: FAMILY_ROOM_ID, winningScore: 1 });
      await brad.until((st) => st.winningScore === 1);
      autoPlay(brad);
      autoPlay(rowan);
      brad.emit('start_game', { roomId: FAMILY_ROOM_ID });
      await brad.until((st) => st.state === 'winner', 'the end of the game', FULL_GAME_TIMEOUT_MS - 1000);

      let stats: { people: { key: string; family: { games: number; wins: number } | null }[]; recent: unknown[] } | null = null;
      for (let i = 0; i < 50 && !stats?.recent.length; i++) {
        await sleep(50);
        stats = await (await fetch(`${url}/api/stats`)).json();
      }
      expect(stats!.recent).toHaveLength(1);
      const people = Object.fromEntries(stats!.people.map((p) => [p.key, p.family]));
      expect(people.brad!.games).toBe(1);
      expect(people.rowan!.games).toBe(1);
      expect(people.brad!.wins + people.rowan!.wins).toBe(1);
    } finally {
      await statsApi.close();
    }
  }, FULL_GAME_TIMEOUT_MS);

  it("keeps a lobby seat for someone who reconnects and drops again (the old timer doesn't remove them early)", async () => {
    const { url } = await startServer({ ...FAST, lobbySeatGraceMs: 1000 });
    const brad = await device(url);
    const watcher = await device(url);
    brad.emit('select_avatar', { roomId: FAMILY_ROOM_ID, avatarChoice: 'brad' });
    await seatedAs(brad, 'brad');

    brad.close(); // t = 0
    await sleep(100);
    const again = await device(url, { token: brad.token }); // back at ~100ms
    await sleep(400);
    again.close(); // gone again at ~500ms
    await sleep(650); // the first timer (from t = 0) has fired by ~1000ms
    expect(watcher.state()?.players.some((p) => p.playerId === brad.id)).toBe(true);
    await watcher.until((s) => !s.players.some((p) => p.playerId === brad.id), 'seat released after the second grace', 2000);
  });
});

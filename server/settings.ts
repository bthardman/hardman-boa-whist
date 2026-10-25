// The family table's settings (points to win, pace, computer difficulty) are saved to the stats
// API, so a server restart (a deploy, or Render waking from sleep) doesn't reset them to defaults.
import { FAMILY_ROOM_ID } from '../shared/players.ts';
import { parseTableSettings, type TableSettings } from '../shared/stats.ts';
import type { GameState } from '../shared/types.ts';
import type { Ctx } from './context.ts';
import { broadcastState } from './view.ts';

export type SettingsStore = {
  load(): Promise<TableSettings | null>;
  save(settings: TableSettings): Promise<void>;
};

/** Saves come in bursts (tapping through the choices); only the last one is sent. */
const SAVE_DELAY_MS = 1500;

const settingsOf = (room: GameState): TableSettings => ({
  winningScore: room.winningScore ?? 5,
  gameSpeed: room.gameSpeed ?? 'normal',
  botDifficulty: room.botDifficulty ?? 'medium'
});

/** Loads the saved settings: new tables start with them, and the family table takes them if it's in the lobby. */
export async function loadTableSettings(ctx: Ctx): Promise<void> {
  if (!ctx.settingsStore) return;
  try {
    const saved = await ctx.settingsStore.load();
    if (!saved) return;
    ctx.rooms.settingsForNewRooms = saved;
    const family = ctx.rooms.getRoom(FAMILY_ROOM_ID);
    if (family && family.state === 'lobby') {
      Object.assign(family, saved);
      broadcastState(ctx, family);
    }
  } catch (err) {
    console.error('Could not load the saved table settings', err);
  }
}

/** Call after the family table's settings change. */
export function saveTableSettingsSoon(ctx: Ctx, room: GameState): void {
  if (room.roomId !== FAMILY_ROOM_ID) return;
  const settings = settingsOf(room);
  ctx.rooms.settingsForNewRooms = settings;
  if (!ctx.settingsStore) return;
  ctx.clearTimer(ctx.settingsSaveTimer);
  ctx.settingsSaveTimer = ctx.setTimer(() => {
    ctx.settingsStore?.save(settings).catch((err) => console.error('Could not save the table settings', err));
  }, SAVE_DELAY_MS);
}

/** Settings kept by the stats API at `url` (the Pages site), using the shared secret. */
export function httpSettingsStore(url: string, secret: string): SettingsStore {
  const endpoint = `${url.replace(/\/+$/, '')}/api/settings`;
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${secret}` };
  return {
    async load() {
      const res = await fetch(endpoint, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseTableSettings(await res.json());
    },
    async save(settings) {
      const res = await fetch(endpoint, { method: 'PUT', headers, body: JSON.stringify(settings) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }
  };
}

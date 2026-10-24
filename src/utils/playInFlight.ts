// A card has been sent to the server and we're waiting to hear back. Shared by every card in the
// hand, so two quick taps can't send two cards. Cleared when the turn moves on or the play is
// rejected (so the same card, or another, can be tapped again).
import { writable } from 'svelte/store';

export const playInFlight = writable(false);

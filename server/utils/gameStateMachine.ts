// Game state machine for managing state transitions
import type { GameState, State } from '../../shared/types.ts';

export class GameStateMachine {
  static canTransition(currentState: State, newState: State): boolean {
    const validTransitions: Record<State, State[]> = {
      lobby: ['bidding'],
      bidding: ['tricks'],
      tricks: ['tricks', 'round_end', 'winner'],
      round_end: ['bidding', 'winner'],
      winner: []
    };

    return validTransitions[currentState]?.includes(newState) ?? false;
  }

  static transition(room: GameState, newState: State): boolean {
    if (this.canTransition(room.state, newState)) {
      room.state = newState;
      return true;
    }
    return false;
  }
}

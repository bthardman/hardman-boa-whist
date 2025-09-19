import { AvatarChoice } from '../shared/types';

export interface AvatarData {
  name: string;
  avatar1: string;
  avatar2: string;
}

export const avatarDataMap: Record<AvatarChoice, AvatarData> = {
  [AvatarChoice.ANGELA]: {
    name: 'Angela',
    avatar1: '/avatars/angela_1.png',
    avatar2: '/avatars/angela_2.png'
  },
  [AvatarChoice.BRAD]: {
    name: 'Brad',
    avatar1: '/avatars/brad_1.png',
    avatar2: '/avatars/brad_2.png'
  },
  [AvatarChoice.CAROL]: {
    name: 'Carol',
    avatar1: '/avatars/carol_1.png',
    avatar2: '/avatars/carol_2.png'
  },
  [AvatarChoice.DEREK]: {
    name: 'Derek',
    avatar1: '/avatars/derek_1.png',
    avatar2: '/avatars/derek_2.png'
  },
  [AvatarChoice.ROWAN]: {
    name: 'Rowan',
    avatar1: '/avatars/rowan_1.png',
    avatar2: '/avatars/rowan_2.png'
  },
  [AvatarChoice.TONY]: {
    name: 'Tony',
    avatar1: '/avatars/tony_1.png',
    avatar2: '/avatars/tony_2.png'
  },
  [AvatarChoice.UNDEFINED]: {
    name: 'Unknown',
    avatar1: '',
    avatar2: ''
  }
};

export function getAvatarData(avatarChoice: AvatarChoice): AvatarData {
  return avatarDataMap[avatarChoice];
}

export function getAvatarChoiceByName(name: string): AvatarChoice | undefined {
  const entry = Object.entries(avatarDataMap).find(([_, data]) => data.name.toLowerCase() === name.toLowerCase());
  return entry ? entry[0] as AvatarChoice : undefined;
}

export function getPlayerName(avatarChoice: AvatarChoice): string {
  return avatarDataMap[avatarChoice].name;
}

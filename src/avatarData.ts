import { AvatarChoice } from '../shared/types';

export interface AvatarData {
  name: string;
  avatar1: string;
  avatar2: string;
}

export const avatarDataMap: Record<AvatarChoice, AvatarData> = {
  [AvatarChoice.ANGELA]: {
    name: 'Angela',
    avatar1: '/avatars/angela_1.webp',
    avatar2: '/avatars/angela_2.webp'
  },
  [AvatarChoice.AFRODITI]: {
    name: 'Afroditi',
    avatar1: '/avatars/afroditi_1.webp',
    avatar2: '/avatars/afroditi_2.webp'
  },
  [AvatarChoice.BRAD]: {
    name: 'Brad',
    avatar1: '/avatars/brad_1.webp',
    avatar2: '/avatars/brad_2.webp'
  },
  [AvatarChoice.CAROL]: {
    name: 'Carol',
    avatar1: '/avatars/carol_1.webp',
    avatar2: '/avatars/carol_2.webp'
  },
  [AvatarChoice.DEREK]: {
    name: 'Derek',
    avatar1: '/avatars/derek_1.webp',
    avatar2: '/avatars/derek_2.webp'
  },
  [AvatarChoice.ROWAN]: {
    name: 'Rowan',
    avatar1: '/avatars/rowan_1.webp',
    avatar2: '/avatars/rowan_2.webp'
  },
  [AvatarChoice.TONY]: {
    name: 'Tony',
    avatar1: '/avatars/tony_1.webp',
    avatar2: '/avatars/tony_2.webp'
  },
  [AvatarChoice.VANESSA]: {
    name: 'Vanessa',
    avatar1: '/avatars/vanessa_1.webp',
    avatar2: '/avatars/vanessa_2.webp'
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

export function getPlayerName(avatarChoice: AvatarChoice): string {
  return avatarDataMap[avatarChoice].name;
}

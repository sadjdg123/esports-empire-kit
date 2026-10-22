import type { Archetype, ClubStyle, Role } from '../core/types';

export const ROLE_NAME: Record<Role, string> = { TOP: '上单', JUNGLE: '打野', MID: '中单', ADC: '射手', SUPPORT: '辅助' };
export const ARCHETYPE_NAME: Record<Archetype, string> = { TANK: '坦克', ASSASSIN: '刺客', MAGE: '法师', MARKSMAN: '射手', SUPPORT: '辅助' };
export const STYLE_NAME: Record<ClubStyle | 'PLAYER', string> = {
  EARLY_AGGRO: '前期猛攻', STEADY_MACRO: '稳健运营', TEAMFIGHT_PUSH: '团战推进', SPLIT_PUSH: '分带牵制', RANDOM: '战术多变', PLAYER: '你的俱乐部',
};
export const CLUB_COLORS = ['#3a7bd5', '#d9572b', '#2fa36b', '#9b59b6', '#e0b100', '#e84a7f'];

export function money(n: number): string {
  const v = Math.round(n);
  return `${v < 0 ? '-' : ''}¥${Math.abs(v).toLocaleString('zh-CN')}`;
}

export function minutes(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

import type { Archetype, ClubStyle, FacilityId, FacilityLevel, Role, TrainingFocus } from '../core/types';

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

export const FOCUS_NAME: Record<TrainingFocus, string> = {
  MECHANICS: '操作', AWARENESS: '意识', TEAMWORK: '配合', MENTAL: '心态', MASTERY: '英雄熟练度', REST: '休息',
};

export const FOCUS_HINT: Record<TrainingFocus, string> = {
  MECHANICS: '伤害、技能命中、补刀',
  AWARENESS: '撤退时机、察觉抓人、决策',
  TEAMWORK: '集合速度、集火目标',
  MENTAL: '落后时不崩',
  MASTERY: '每人最拿手的几个英雄更熟练',
  REST: '不涨能力，但能大幅恢复疲劳，也不花训练费',
};

/** Hidden potential shown only as a rough scouting word. */
export function growthRoom(potential: number | undefined, overall: number): string {
  const room = (potential ?? overall) - overall;
  return room >= 15 ? '很大' : room >= 8 ? '较大' : room >= 3 ? '一般' : '接近上限';
}

export const PLAYOFF_NAME: Record<'CHAMPION' | 'FINAL' | 'SEMI' | 'NONE', string> = {
  CHAMPION: '🏆 总冠军', FINAL: '亚军', SEMI: '半决赛', NONE: '未进季后赛',
};

/** What a room does at one of its levels, in a few words (T22). */
export function facilityEffectText(id: FacilityId, step: FacilityLevel): string {
  const pct = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;
  if (step.value === 0 && !step.sponsorReputation) return '基础设备，没有加成';
  switch (id) {
    case 'TRAINING': return `训练成长 +${pct(step.value)}`;
    case 'LOUNGE': return `每天多恢复 ${step.value} 点疲劳`;
    case 'OFFICE': return `续约要价 −${pct(step.value)}，赞助门槛 −${step.sponsorReputation ?? 0} 声望`;
    case 'ANALYSIS': return `英雄熟练度成长 +${pct(step.value)}`;
    case 'STREAM': return `周边收入 +${pct(step.value)}`;
  }
}

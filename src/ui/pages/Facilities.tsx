import { FACILITY_IDS } from '../../core/types';
import { facilityDef, facilityLevel, facilityStep, facilityUpkeep, nextFacilityLevel, upgradeFacility } from '../../game';
import type { PageProps } from '../App';
import { facilityEffectText, money } from '../labels';

/** Room upgrades (T22): every room has three levels; each costs once and a little every week. */
export function FacilitiesPage({ game, data, act, flash, ask }: PageProps) {
  const club = game.club;
  const upkeep = facilityUpkeep(data, club);
  const upgrade = (id: (typeof FACILITY_IDS)[number]) => {
    const next = nextFacilityLevel(data, club, id);
    const def = facilityDef(data, id);
    if (!next) return;
    ask(`花 ${money(next.cost)} 把${def.name}升到 ${facilityLevel(club, id) + 1} 级？之后每周维护费 ${money(next.upkeep)}。`, '升级', () => {
      const r = act((d) => upgradeFacility(d, data, id));
      flash(r.ok ? `${def.name}升到 ${r.value} 级了` : r.error);
    });
  };
  return (
    <div className="grid">
      <section className="card wide">
        <h2>俱乐部设施</h2>
        <p className="dim">房间升级一次付清，之后每周付维护费。升级后楼里的样子也会变。现在每周维护费 {money(upkeep)}，资金 {money(game.funds)}。</p>
        <div className="facilities">
          {FACILITY_IDS.map((id) => {
            const def = facilityDef(data, id);
            const level = facilityLevel(club, id);
            const next = nextFacilityLevel(data, club, id);
            return (
              <div key={id} className="facility">
                <div className="row between">
                  <b>{def.name}</b>
                  <span className="stars" aria-label={`${level} 级`}>{'★'.repeat(level)}<span className="dim">{'★'.repeat(def.levels.length - level)}</span></span>
                </div>
                <div className="dim small-text">现在：{facilityEffectText(id, facilityStep(data, club, id))}</div>
                {next ? (
                  <>
                    <div className="small-text">下一级：{facilityEffectText(id, next)} · 每周维护 {money(next.upkeep)}</div>
                    <button className="primary" onClick={() => upgrade(id)} disabled={game.funds < next.cost}>升级 {money(next.cost)}</button>
                  </>
                ) : <div className="good small-text">已经是最高级</div>}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

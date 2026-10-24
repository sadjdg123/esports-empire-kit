// Pixel icons for the menu (12x12), drawn once and kept as image URLs.
import { makeSprite } from '../render/pixel/raster';

const PAL = { o: '#2a1a14', w: '#ffffff', g: '#c9cdd6', b: '#3a7bd5', B: '#2a5aa5', r: '#e05a4a', y: '#f2c230', Y: '#c99a1a', n: '#8a5a34', N: '#6b4a2b', e: '#59b36b', E: '#3e8a4f', p: '#f08aa6', k: '#22252e', c: '#7fe3ff', s: '#f1c9a5' };

const ROWS: Record<string, string[]> = {
  lineup: ['oooooooooooo', 'owwwwwwwwwwo', 'owbwwwwwrwwo', 'owwwbwwwwwwo', 'owbwwwkwwrwo', 'owwwwkwkwwwo', 'owwbwwwwwrwo', 'owwwwwwwwwwo', 'oooooooooooo', '...o....o...', '..o......o..', '.o........o.'],
  training: ['............', 'oo......oo..', 'okko..okko..', 'okkooooookko', 'okkggggggkko', 'okkooooookko', 'okko..okko..', 'oo......oo..', '............', '............', '............', '............'].map((r) => r),
  market: ['....oooo....', '...osssso...', '...osoosso..', '...ossssso..', '....oooo....', '..oobbbboo..', '.obbbbbbbbo.', '.obbbbbbbbo.', '.obbbbbbbbo.', '..oooooooo..', '......ooo...', '.....ooyoo..'],
  contracts: ['.ooooooooo..', '.owwwwwwwo..', '.owkkkkkwo..', '.owwwwwwwo..', '.owkkkkwwo..', '.owwwwwwwo..', '.owkkkwwwoo.', '.owwwwwwoyo.', '.owwwwwoyyo.', '.oooooooYo..', '.......oo...', '............'],
  schedule: ['.o..o..o..o.', 'oooooooooooo', 'orrrrrrrrrro', 'oooooooooooo', 'owwowwowwowo', 'owwowwowwowo', 'oooooooooooo', 'owwowwobbowo', 'owwowwobbowo', 'oooooooooooo', '............', '............'],
  finance: ['...oooooo...', '..oyyyyyyo..', '.oyyYYYYyyo.', '.oyYyyyyYyo.', '.oyyYYYyyyo.', '.oyyyyyYyyo.', '.oyYYYYyyyo.', '.oyyyyyyyyo.', '..oyyyyyyo..', '...oooooo...', '............', '............'],
  inbox: ['............', 'oooooooooooo', 'owwwwwwwwwwo', 'oowwwwwwwwoo', 'owowwwwwwowo', 'owwowwwwowwo', 'owwwowwowwwo', 'owwwwoowwwwo', 'owwwwwwwwwwo', 'oooooooooooo', '............', '............'],
  report: ['............', '.oooooooooo.', '.orrrrorrro.', '.orwwrorwwo.', '.orwwrorwwo.', '.orrrrorrro.', '.orwwrorwwo.', '.orrrrorrro.', '.oooooooooo.', '............', '............', '............'],
  history: ['.oooooooooo.', 'oyoyyyyyyoyo', 'oyoyyyyyyoyo', '.ooyyyyyyoo.', '...oyyyyo...', '....oyyo....', '.....oo.....', '.....yy.....', '....oyyo....', '...oooooo...', '...onnnno...', '...oooooo...'],
  home: ['.....oo.....', '....orro....', '...orrrro...', '..orrrrrro..', '.orrrrrrrro.', 'oooooooooooo', '.onnnnnnnno.', '.onwwnnoono.', '.onwwnnoono.', '.onnnnnoono.', '.oooooooooo.', '............'],
  // A person with a tie and a clipboard (P3 staff).
  staff: ['....oooo....', '...osssso...', '...osoosso..', '...ossssso..', '....oooo....', '..ookrkkoo..', '.okkkrkkkko.', '.okkkrkkkoww', '.okkkkkkkoww', '..oooooooo..', '...oo..oo...', '............'],
  facilities: ['............', '....oooo....', '...okkkko...', '...o....o...', 'oooooooooooo', 'orrrrrrrrrro', 'orrrryyrrrro', 'oooooyyooooo', 'orrrrrrrrrro', 'orrrrrrrrrro', 'oooooooooooo', '............'],
  settings: ['....oooo....', '.oo.oggo.oo.', '.oggoggoggo.', '..oggggggo..', 'oogggoogggoo', 'ogggo..ogggo', 'ogggo..ogggo', 'oogggoogggoo', '..oggggggo..', '.oggoggoggo.', '.oo.oggo.oo.', '....oooo....'],
};

const cache = new Map<string, string>();

export function iconUrl(name: keyof typeof ROWS | string): string {
  let url = cache.get(name);
  if (!url) {
    url = makeSprite(ROWS[name] ?? ROWS.home!, PAL).toDataURL();
    cache.set(name, url);
  }
  return url;
}

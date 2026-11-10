// Builds the offline folder and turns the module script tag into a plain one (browsers refuse
// to load module scripts from file://). Usage: npm run pack
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const out = 'release/esports-empire-offline';
execSync('npx tsc -b && npx vite build --config vite.offline.config.ts', { stdio: 'inherit' });
const file = `${out}/index.html`;
let html = readFileSync(file, 'utf8');
const before = html;
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/, '').replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/, '<link rel="stylesheet" href="$1">');
const src = before.match(/<script type="module" crossorigin src="([^"]+)"><\/script>/)?.[1];
if (!src) throw new Error('pack-offline: script tag not found in index.html');
// A classic script must run after #root exists: put it at the end of the body.
html = html.replace('</body>', `  <script src="${src}"></script>\n  </body>`);
writeFileSync(file, html);
writeFileSync(`${out}/怎么玩.txt`, ['电竞帝国 离线版', '', '双击 index.html，用 Chrome 或 Edge 打开就能玩，不用联网。', '存档保存在这台电脑的浏览器里。换电脑前，到游戏里"设置 → 复制存档文本"保存好。', '不要删除或移动 game.js，它要和 index.html 放在同一个文件夹。', ''].join('\r\n'));
process.stdout.write(`离线版已生成：${out}/（双击里面的 index.html）` + "\n");

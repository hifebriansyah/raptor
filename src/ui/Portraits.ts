/**
 * 2D dialogue portraits. Until real art exists each speaker gets a placeholder drawn on a canvas
 * (a flat cartoon bust in their colours). To use custom art, drop a square image in
 * `public/portraits/` and list it in PORTRAIT_FILES, e.g. `Grandma: 'grandma.png'`.
 */
export const PORTRAIT_FILES: Partial<Record<string, string>> = {};

interface Look {
  bg: string;
  skin: string;
  hair: string;
  shirt: string;
  extra?: 'bun' | 'cap' | 'kaiju' | 'goggles' | 'glasses' | 'mask';
  hat?: string;
}

const LOOKS: Record<string, Look> = {
  Professor: { bg: '#cfe8ff', skin: '#f2c9a0', hair: '#6b4226', shirt: '#f5f7fa', extra: 'goggles' },
  Grandma: { bg: '#ffd6e7', skin: '#f2d0b5', hair: '#e5e5e5', shirt: '#b8a1e3', extra: 'bun' },
  Leo: { bg: '#caf0f8', skin: '#e0ac7e', hair: '#5a3825', shirt: '#4cc9f0', extra: 'cap', hat: '#ef476f' },
  Max: { bg: '#d8f3dc', skin: '#e0ac7e', hair: '#5a3825', shirt: '#06d6a0' },
  Gwen: { bg: '#e9f5db', skin: '#f7d7c4', hair: '#7b3f00', shirt: '#4caf50', extra: 'kaiju' },
  Sam: { bg: '#fff1d6', skin: '#c68642', hair: '#111111', shirt: '#ffffff', extra: 'glasses' },
  'Chief Bruno': { bg: '#dbe4ff', skin: '#a86b3c', hair: '#111111', shirt: '#1d3557', extra: 'cap', hat: '#1d3557' },
  Cora: { bg: '#ffe5e5', skin: '#f2c9a0', hair: '#d4a373', shirt: '#9d0208', extra: 'cap', hat: '#2b2d42' },
  Thug: { bg: '#e5e5e5', skin: '#e0ac7e', hair: '#111111', shirt: '#2b2d42', extra: 'mask' },
};

const cache = new Map<string, string>();

export function portraitFor(speaker: string): string {
  const file = PORTRAIT_FILES[speaker];
  if (file) return `${import.meta.env.BASE_URL}portraits/${file}`;
  let url = cache.get(speaker);
  if (url) return url;
  url = draw(LOOKS[speaker] ?? { bg: '#eeeeee', skin: '#e0ac7e', hair: '#5a3825', shirt: '#8d99ae' });
  cache.set(speaker, url);
  return url;
}

function draw(l: Look): string {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = l.bg;
  g.fillRect(0, 0, 128, 128);
  // shoulders
  g.fillStyle = l.shirt;
  g.beginPath();
  g.roundRect(18, 92, 92, 50, 22);
  g.fill();
  // kaiju hood behind the face
  if (l.extra === 'kaiju') {
    g.fillStyle = '#4caf50';
    g.beginPath();
    g.roundRect(26, 14, 76, 86, 26);
    g.fill();
    g.fillStyle = '#ffd166';
    g.fillRect(40, 20, 10, 8);
    g.fillRect(78, 20, 10, 8);
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.moveTo(38 + i * 11, 34);
      g.lineTo(43 + i * 11, 44);
      g.lineTo(48 + i * 11, 34);
      g.fill();
    }
  }
  // hair behind
  g.fillStyle = l.hair;
  if (l.extra !== 'kaiju') {
    g.beginPath();
    g.roundRect(34, 26, 60, 56, 18);
    g.fill();
  }
  // face
  g.fillStyle = l.skin;
  g.beginPath();
  g.roundRect(40, 38, 48, 52, 14);
  g.fill();
  // hair fringe / styles
  g.fillStyle = l.hair;
  if (l.extra !== 'kaiju' && l.extra !== 'cap') {
    g.beginPath();
    g.roundRect(36, 28, 56, 16, 8);
    g.fill();
  }
  if (l.extra === 'bun') {
    g.beginPath();
    g.arc(64, 22, 11, 0, Math.PI * 2);
    g.fill();
  }
  if (l.extra === 'cap') {
    g.fillStyle = l.hat ?? '#e63946';
    g.beginPath();
    g.roundRect(34, 24, 60, 18, 8);
    g.fill();
    g.fillRect(60, 36, 40, 7);
  }
  // eyes + smile
  g.fillStyle = '#222';
  g.fillRect(52, 58, 6, 7);
  g.fillRect(70, 58, 6, 7);
  g.strokeStyle = '#7a3e2b';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(64, 72, 9, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();
  if (l.extra === 'goggles') {
    g.fillStyle = '#3d405b';
    g.fillRect(36, 40, 56, 6);
    g.fillStyle = '#ffd166';
    g.beginPath();
    g.arc(54, 43, 6, 0, Math.PI * 2);
    g.arc(74, 43, 6, 0, Math.PI * 2);
    g.fill();
  }
  if (l.extra === 'glasses') {
    g.strokeStyle = '#333';
    g.lineWidth = 2;
    g.strokeRect(48, 55, 13, 12);
    g.strokeRect(67, 55, 13, 12);
  }
  if (l.extra === 'mask') {
    g.fillStyle = '#111';
    g.fillRect(40, 54, 48, 14);
    g.fillStyle = '#fff';
    g.fillRect(52, 58, 6, 6);
    g.fillRect(70, 58, 6, 6);
  }
  return c.toDataURL();
}

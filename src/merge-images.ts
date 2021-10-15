import { Canvas, Image } from 'canvas';
import { writeFileSync } from 'fs';

type ImageCache = { [k: string]: Image };
const imageCache: ImageCache = {};

export async function loadImage(file: string): Promise<Image> {
  const c = imageCache[file];
  if (c !== undefined) return c;
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = reject;
    image.onload = () => {
      imageCache[file] = image;
      resolve(image);
    };
    image.src = file;
  });
}

export function mergeImages(opts: MergeOptions[], file: string) {
  const w = opts[0].image.width;
  const h = opts[0].image.height;
  const canvas = new Canvas(w, h);
  const c = canvas.getContext("2d");
  for (const opt of opts) {
    if (opt.image.width != w || opt.image.height != h) console.warn("dimension mismatch detected");
    c.drawImage(opt.image, opt.x ?? 0, opt.y ?? 0);
  }
  writeFileSync(file, canvas.toBuffer());
}

export interface MergeOptions {
  image: Image;
  x?: number;
  y?: number;
}

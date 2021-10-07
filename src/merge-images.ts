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

export function mergeImages(images: Image[], file: string) {
  const w = images[0].width;
  const h = images[0].height;
  const canvas = new Canvas(w, h);
  const c = canvas.getContext("2d");
  for (const img of images) {
    if (img.width != w || img.height != h) console.warn("dimension mismatch detected");
    c.drawImage(img, 0, 0);
  }
  writeFileSync(file, canvas.toBuffer());
}

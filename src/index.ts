import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path/posix";
import { exit } from "process";
import * as yaml from "yamljs";
import { lcm } from "./gcd";
import { loadImage, mergeImages } from "./merge-images";
interface ComponentItem {
  trait_value?: string;
  weight: number;
  index: number;
}

interface ComponentEntry {
  trait_type: string;
  folder: string;
  items: ComponentItem[];
}

interface LayerConfig {
  folder: string;
  suffix?: string;
  frames?: number;
}

interface LayerIndex {
  index: number;
  suffix?: string;
  frames?: number;
}

interface Config {
  count: number;
  name: string;
  description: string;
  image: string;
  animation: boolean;
  components: ComponentEntry[];
  layers: LayerConfig[];
}

interface Attribute {
  trait_type: string;
  value: string;
}

interface Metadata {
  name: string;
  description: string;
  image: string;
  attributes: Attribute[];
}

function rand(n: number): number {
  return Math.floor(Math.random() * n);
}

function randomComponentItem(config: ComponentItem[]): ComponentItem {
  const indexWeight: number[] = [];
  const totalWeight = config.reduce((p, v) => {
    const n = p + v.weight;
    indexWeight.push(n);
    return n;
  }, 0);
  const r = rand(totalWeight);
  for (const i in config) {
    if (r < indexWeight[i]) {
      return config[i];
    }
  }
  return config[config.length - 1];
}

function extractAttrubites(components: ComponentEntry[], items: ComponentItem[]): Attribute[] {
  const attributes: Attribute[] = [];
  for (const i in components) {
    const c = components[i];
    const v = items[i];
    if (v.trait_value !== undefined) {
      attributes.push({
        trait_type: c.trait_type,
        value: v.trait_value,
      });  
    }
  }
  return attributes;
}

function getLayerIndex(config: LayerConfig[], components: ComponentEntry[]): LayerIndex[] {
  const folderIndex: {[k: string]: number} = {};
  components.map((v, i) => folderIndex[v.folder] = i);
  return config.map<LayerIndex>((v) => {
    const folder = v.folder;
    if (folderIndex[folder] === undefined) throw `unknown folder ${folder}`;
    return { index: folderIndex[folder], suffix: v.suffix, frames: v.frames };
  });
}

function fillItemIndex(config: Config) {
  for (const component of config.components) {
    for (const i in component.items) {
      component.items[i].index = parseInt(i);
    }
  }
}

async function randomDoll(config: Config, id: number, layer: LayerIndex[]) {
  const components = config.components;
  const current: ComponentItem[] = [];
  for (const component of components) {
    current.push(randomComponentItem(component.items));
  }

  const prefix = path.join("out", `${id}`);

  // save metadata
  const metadata: Metadata = {
    name: `${config.name} #${id}`,
    description: config.description,
    image: config.image.replace("{}", `${id}`),
    attributes: extractAttrubites(config.components, current),
  };
  writeFileSync(prefix + ".json", JSON.stringify(metadata, undefined, 2));

  // save png
  const frames = layer.map((v) => v.frames ?? 1);
  const step = config.animation ? lcm(frames) : 1;
  if (config.animation && !existsSync(prefix)) mkdirSync(prefix);
  for (let i = 0; i < step; ++i) {
    const ps = layer.map((v, vi) => {
      const folder = components[v.index].folder;
      const number = (current[v.index].index + 1).toString().padStart(2, "0");
      const suffix = v.suffix ? "-" + v.suffix : "";
      const frame = frames[vi] > 1 ? "-" + ((i % frames[vi]) + 1).toString().padStart(2, "0") : "";
      return loadImage(path.join("data", folder, `${folder}${number}${suffix}${frame}.png`));
    });
    const images = await Promise.all(ps);
    const frame = (i + 1).toString().padStart(2, "0");
    const file = config.animation ? path.join(prefix, `${frame}.png`) : `${prefix}.png`
    mergeImages(images, file);
  }
}

async function main() {
  const config: Config = yaml.load("config.yaml");

  if (!existsSync("out")) mkdirSync("out");

  const layerIndex = getLayerIndex(config.layers, config.components);
  fillItemIndex(config);

  for (let i = 0; i < config.count; ++i) {
    const id = i + 1
    console.log(`generating #${id}`);
    await randomDoll(config, id, layerIndex);
  }

  console.log("done");
}

main().catch((e) => {
  console.error(e);
  exit(1);
});

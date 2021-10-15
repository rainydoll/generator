import { existsSync, mkdirSync, writeFileSync } from "fs";
import { sync as globSync } from "glob";
import path from "path";
import { exit } from "process";
import * as yaml from "yamljs";
import { lcm } from "./gcd";
import { loadImage, mergeImages } from "./merge-images";

interface ComponentItem {
  trait_value?: string;
  weight: number;
  index: number;
  frames?: number;
}

interface ComponentEntry {
  trait_type: string;
  folder: string;
  items: ComponentItem[];
}

interface LayerConfig {
  index: number;
  folder: string;
  suffix?: string;
  frames?: number;
}

interface Config {
  count: number;
  animation: boolean;
  metadata?: {
    name: string;
    description: string;
    image: string;  
  };
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

const DataDir = "data";
const OutputDir = "out";

type GeneratedMap = { [key: string]: boolean };

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

function fillIndex(config: Config) {
  const layers = config.layers;
  const components = config.components;
  const folderIndex: {[k: string]: number} = {};
  components.map((v, i) => { 
    folderIndex[v.folder] = i;
    for (const i in v.items)
      v.items[i].index = parseInt(i);
  });
  layers.map((layer) => {
    const folder = layer.folder;
    if (folderIndex[folder] === undefined) throw `unknown folder ${folder}`;
    layer.index = folderIndex[folder];
  });
}

function randomComponents(components: ComponentEntry[], generated: GeneratedMap): ComponentItem[]|undefined {
  for (let i = 0; i < 20; ++i) {
    const current: ComponentItem[] = [];
    for (const component of components) {
      current.push(randomComponentItem(component.items));
    }
    const key = current.map(v => v.index).join("|");
    if (generated[key]) continue;
    generated[key] = true;
    return current;  
  }
  return undefined;
}

async function randomDoll(config: Config, id: number, generated: GeneratedMap): Promise<boolean> {
  const components = config.components;
  const current = randomComponents(config.components, generated);
  if (current === undefined) return false;

  const prefix = path.join(OutputDir, `${id}`);

  if (config.metadata) {
    // save metadata
    const metadata: Metadata = {
      name: `${config.metadata.name} #${id}`,
      description: config.metadata.description,
      image: config.metadata.image.replace("{}", `${id}`),
      attributes: extractAttrubites(config.components, current),
    };
    writeFileSync(prefix + ".json", JSON.stringify(metadata, undefined, 2));
  }

  // save png
  const layers = config.layers;
  const frames = layers.map((v) =>  current[v.index].frames ?? v.frames ?? 1);
  const step = config.animation ? lcm(frames) : 1;
  if (config.animation && !existsSync(prefix)) mkdirSync(prefix);
  for (let i = 0; i < step; ++i) {
    const ps = layers.map((v, vi) => {
      const folder = components[v.index].folder;
      const number = (current[v.index].index + 1).toString().padStart(2, "0");
      const suffix = v.suffix ? "-" + v.suffix : "";
      const frame = frames[vi] > 1 ? "-" + ((i % frames[vi]) + 1).toString().padStart(2, "0") : "";
      // find all case-insensitive files
      const file = path.join(DataDir, folder, `${number}${suffix}${frame}.png`);
      const f = globSync(file, { nocase: true });
      if (f.length !== 1) throw "need exactly 1 file";
      return loadImage(f[0]);
    });
    const images = await Promise.all(ps);
    const frame = (i + 1).toString().padStart(2, "0");
    const file = config.animation ? path.join(prefix, `${frame}.png`) : `${prefix}.png`
    mergeImages(images, file);
  }

  return true;
}

function loadConfig(): Config {
  let config: any;
  if (existsSync("config.yaml")) {
    config = yaml.load("config.yaml");
  } else {
    console.log("no config.yaml use auto-discovery mode");
  }
  if (config === undefined) config = {};
  if (config.count === undefined) config.count = 100;
  if (config.animation === undefined) config.animation = false;
  if (config.layers === undefined) {
    const layers: LayerConfig[] = [];
    for (const folder of globSync(path.join(DataDir, "*"))) {
      const f = folder.substr(DataDir.length + 1); // data/
      layers.push({ folder: f, index: -1 });
    }
    console.log(`${layers.length} folders detected (${layers.map(v => v.folder).join(", ")})`);
    config.layers = layers;
  }
  if (config.animations === undefined) {
    config.animations = [];
  }
  if (config.components === undefined) {
    console.log("auto-discovery components");
    const layers: LayerConfig[] = config.layers;
    const folders: { [folder: string]: number } = {};
    for (const layer of layers) {
      folders[layer.folder] = (folders[layer.folder] ?? 0) + 1;
    }
    const components: ComponentEntry[] = [];
    for (const layer of layers) {
      const items: ComponentItem[] = [];
      for (const file of globSync(path.join(DataDir, layer.folder, "*.png"), { nocase: true })) {
        items.push({ weight: 1, index: 0 });
      }
      // in case of one component with multiple layers, remove exceed images
      const componentLayer = folders[layer.folder];
      if (componentLayer > 1) {
        const l = items.length / componentLayer;
        items.splice(l, items.length - l);
      }
      components.push({ trait_type: "", folder: layer.folder, items });  
    }
    config.components = components;
  }
  return config;
}

async function main() {
  const config = loadConfig();

  if (!existsSync(OutputDir)) mkdirSync(OutputDir);

  fillIndex(config);

  const generated: GeneratedMap = {};

  for (let i = 0; i < config.count; ++i) {
    const id = i + 1;
    console.log(`generating #${id}`);
    if (!await randomDoll(config, id, generated)) break;
  }

  console.log("done");
}

main().catch((e) => {
  console.error(e);
  exit(1);
});

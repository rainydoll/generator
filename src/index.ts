import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { sync as globSync } from "glob";
import minimist from "minimist";
import path from "path";
import { exit } from "process";
import * as yaml from "yamljs";
import { lcm } from "./gcd";
import { loadJS } from "./hook";
import { loadImage, mergeImages, MergeOptions } from "./merge-images";

type HookFunction = (current: number[]) => number[]|undefined;

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
  index: number;  // folder index
  folder: string;
  suffix?: string;
  frames?: number;
}

interface TranslationEntry {
  index: number;  // layer index
  folder: string;
  suffix?: string;
  x: number;
  y: number;
}

interface AnimationEntry {
  translates?: TranslationEntry[];
}

interface Config {
  count: number;
  animation: boolean;
  hook?: string;
  hook_function?: HookFunction;
  metadata: Metadata;
  animations: AnimationEntry[];
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
  id?: number;
  source?: string;
  parts?: number[];
  attributes?: Attribute[];
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
  const folderIndex: {[k: string]: number} = {};
  config.components.map((v, i) => { 
    folderIndex[v.folder] = i;
    for (const i in v.items)
      v.items[i].index = parseInt(i);
  });
  const layers = config.layers;
  layers.map((v) => {
    const folder = v.folder;
    if (folderIndex[folder] === undefined) throw `unknown folder ${folder}`;
    v.index = folderIndex[folder];
  });
  config.animations.map((v) => {
    if (v.translates === undefined) return;
    for (const t of v.translates) {
      const index = layers.findIndex((v) => v.folder === t.folder && v.suffix === t.suffix);
      if (index < 0) throw `bad folder ${t.folder}`;
      t.index = index;
    }
  });
}

function randomComponents(components: ComponentEntry[], generated: GeneratedMap, hook?: HookFunction): ComponentItem[]|undefined {
  for (let i = 0; i < 20; ++i) {
    const current: ComponentItem[] = [];
    for (const component of components) {
      current.push(randomComponentItem(component.items));
    }
    // hook generation
    if (hook !== undefined) {
      const updated = hook(current.map(v => v.index));
      if (updated !== undefined) {
        current.splice(0, current.length);
        components.map((v, vi) => current.push(v.items[updated[vi]]));
      }
    }
    const key = current.map(v => v.index).join("|");
    if (generated[key]) continue;
    generated[key] = true;
    return current;
  }
  return undefined;
}

function sequencialComponents(components: ComponentEntry[], index: number): ComponentItem[] {
  const current: ComponentItem[] = [];
  for (const component of components) {
    current.push(component.items[index % component.items.length]);
  }
  return current;  
}

function loadSequencialComponents(components: ComponentEntry[], count: number): ComponentItem[][] {
  const result: ComponentItem[][] = [];
  for (let i = 0; i < count; ++i)
    result.push(sequencialComponents(components, i));
  return result;
}

function loadMetadata(components: ComponentEntry[], filename: string): ComponentItem[][] {
  const metadata: Metadata[] = JSON.parse(readFileSync(filename, "utf-8"));
  return metadata.map((e) => {
    if (e.parts === undefined) throw "no parts";
    return e.parts.map((v, vi) => components[vi].items[v]);
  });
}

function loadParts(config: Config, argv: minimist.ParsedArgs): ComponentItem[][] {
  const components = config.components;
  if (argv["load-metadata"]) {
    return loadMetadata(components, argv["load-metadata"]);
  }
  if (argv["sequence"]) {
    return loadSequencialComponents(components, config.count);
  }
  return [];
}

function getMetadata(config: Config, id: number, current: ComponentItem[]): Metadata {
  const master = config.metadata;
  if (master === undefined) throw "no metadata";
  const components = config.components;
  const metadata: Metadata = {
    name: `${master.name} #${id}`,
    description: master.description,
    image: master.image.replace("{}", `${id}`),
    id: id,
    source: master.source,
    parts: current.map((v) => v.index),
    attributes: extractAttrubites(components, current),
  };
  return metadata;
}

async function saveDoll(config: Config, id: number, current: ComponentItem[]) {
  const components = config.components;
  const prefix = path.join(OutputDir, `${id}`);

  // save png
  const layers = config.layers;
  const frames = layers.map((v) =>  current[v.index].frames ?? v.frames ?? 1);
  const animations = config.animations;
  if (animations.length > 1) frames.push(animations.length);
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
      if (f.length !== 1) throw `need exactly 1 file ${file} ${JSON.stringify(f)}`;
      return loadImage(f[0]);
    });
    const images = await Promise.all(ps);
    const opts = images.map<MergeOptions>((image) => ({ image }));
    const animation = animations.length > 0 ? animations[i % animations.length] : {};
    if (animation.translates) animation.translates.map((v) => {
      opts[v.index].x = v.x;
      opts[v.index].y = v.y;
    });
    const frame = (i + 1).toString().padStart(2, "0");
    const file = config.animation ? path.join(prefix, `${frame}.png`) : `${prefix}.png`
    mergeImages(opts, file);
  }
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
      layers.push({ folder: f } as LayerConfig);
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
    const folderLayers: { [folder: string]: number } = {};
    for (const layer of layers) {
      folderLayers[layer.folder] = (folderLayers[layer.folder] ?? 0) + 1;
    }
    const inspectedFolders: { [folder: string]: boolean } = {};
    const components: ComponentEntry[] = [];
    for (const layer of layers) {
      const folder = layer.folder;
      if (inspectedFolders[folder]) continue;
      inspectedFolders[folder] = true;
      const items: ComponentItem[] = [];
      for (let i = 1; i < 900; ++i) {
        const files = globSync(path.join(DataDir, folder, `${i.toString().padStart(2, "0")}?(-*).png`), { nocase: true });
        if (files.length === 0) break;
        const frames = Math.ceil(files.length / folderLayers[folder]);
        const item = { trait_value: `${folder} #${i}`, weight: 1 } as ComponentItem;
        if (frames > 1) item.frames = frames;
        items.push(item);
      }
      components.push({ trait_type: folder, folder: folder, items });
      console.log(`folder ${folder} ${items.length} items`);
    }
    config.components = components;
  }
  return config;
}

function fillConfig(config: Config) {
  if (config.hook !== undefined) {
    config.hook_function = loadJS(config.hook).hook;
  }
}

async function main() {
  const argv = minimist(process.argv.slice(2), {
    alias: {
      "h": "help",
      "s": "sequence",
    },
  });

  if (argv["help"]) {
    console.error(`usage: ${path.basename(process.argv[1])} [--help|-h] [--sequence|-s] [--export-config <config.yaml>] [--skip-images] [--load-metadata <metadata.json>] [--save-metadata <metadata.json>] [--save-statistics <statistics.json>] [--offset <start generating at>] [--count <generating count>]`);
    exit(1);
  }

  const config = loadConfig();
  if (argv["export-config"]) {
    writeFileSync(argv["export-config"], yaml.stringify(config, 4, 2));
  }
  fillConfig(config);

  if (!existsSync(OutputDir)) mkdirSync(OutputDir);

  fillIndex(config);

  const components = config.components;
  const generated: GeneratedMap = {};
  const metadata: Metadata[] = [];
  const statistics: number[][] = components.map((e) => e.items.map((v) => 0));

  const parts = loadParts(config, argv);
  const offset = argv["offset"] ? parseInt(argv["offset"]) - 1 : 0;
  const count = argv["count"] ?  offset + parseInt(argv["count"]) : (parts.length > 0 ? parts.length : config.count);

  for (let i = offset; i < count; ++i) {
    const id = i + 1;
    console.log(`generating #${id}`);
    const current = parts[i] ?? randomComponents(components, generated, config.hook_function);
    if (!current) break;
    if (!argv["skip-images"])
      await saveDoll(config, id, current);
    if (config.metadata !== undefined)
      metadata.push(getMetadata(config, id, current));
    current.map((v, vi) => statistics[vi][v.index]++ );
  }

  if (argv["save-metadata"]) writeFileSync(argv["save-metadata"], JSON.stringify(metadata));
  if (argv["save-statistics"]) writeFileSync(argv["save-statistics"], JSON.stringify(statistics));

  console.log("done");
}

main().catch((e) => {
  console.error(e);
  exit(1);
});

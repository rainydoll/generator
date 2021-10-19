import { readFileSync } from "fs";
import { createContext, Script } from "vm";

export function loadJS(filename: string): any {
  const js = readFileSync(filename, "utf-8");
  const module = { exports: {} };
  const context = createContext({ exports: module.exports, module });
  const script = new Script(js);
  script.runInContext(context);
  return module.exports;
}

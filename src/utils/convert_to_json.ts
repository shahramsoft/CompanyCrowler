import { readFileSync } from "fs";

export function convert_to_json(path: string) {
  const file = readFileSync(path, "utf-8");

  const lines = file.split("\n");
  lines.pop();

  const keys = lines[0].split("	");
  keys.pop();

  const list = [] as any[];
  for (let i = 1; i < lines.length; i++) {
    const data = lines[i].split("	");
    const obj: any = {};
    for (let j = 0; j < keys.length; j++) {
      const key = keys[j];
      obj[key] = data[j];
    }
    list.push(obj);
  }

  return list;
}

import { readFileSync } from "fs";

export function getJson(path: string) {
  const file = readFileSync(path, "utf-8");
  const json = JSON.parse(file);
  return json;
}

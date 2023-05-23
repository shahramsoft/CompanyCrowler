import { readFileSync, writeFileSync } from "fs";

export function getJson(path: string) {
  const file = readFileSync(path, "utf-8");
  const json = JSON.parse(file);
  return json;
}

export function setJson(path: string, json: any) {
  writeFileSync(path, JSON.stringify(json));
}

export function doneHSCode(hscode: string) {
  const final = getJson("data/final.json");
  final.push(hscode);
  setJson("data/final.json", final);
}

export function didHSCode(hscode:string){
  const final = getJson("data/final.json") as string[];
  return final.includes(hscode);
}
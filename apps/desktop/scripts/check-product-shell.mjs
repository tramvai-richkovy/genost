import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appSource = readFileSync(resolve(root, "src/App.tsx"), "utf8");
if (!appSource.includes("SessionStudio")) {
  throw new Error("The active desktop entrypoint must mount SessionStudio.");
}

const forbiddenSourceImports = [
  "ProjectBrowser",
  "ProjectWorkspace",
  "StartupModeGate",
  "RenderQueueProcessor",
];
for (const name of forbiddenSourceImports) {
  if (appSource.includes(name)) {
    throw new Error(`The active desktop entrypoint must not mount the song-project POC: ${name}`);
  }
}

const assetDirectory = resolve(root, "dist/assets");
const javascript = readdirSync(assetDirectory)
  .filter((name) => name.endsWith(".js"))
  .map((name) => readFileSync(resolve(assetDirectory, name), "utf8"))
  .join("\n");
for (const marker of ["Project Browser", "CompositionTab", "ProjectWorkspace"]) {
  if (javascript.includes(marker)) {
    throw new Error(`The production bundle contains a song-project shell marker: ${marker}`);
  }
}

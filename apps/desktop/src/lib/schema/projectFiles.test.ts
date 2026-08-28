import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { commandJournalSchema, genostProjectSchema } from "./project";

const repositoryRoot = resolve(process.cwd(), "../..");
const smtvRoot = resolve(repositoryRoot, "../ost_drafts");
const smtvFolders = [
  "smtv Sketch 01",
  "smtv Sketch 02 - Salt Glass Shinagawa",
  "smtv Sketch 03 - Iron Basilica Chiyoda",
  "smtv Sketch 04 - Godless Ueno Spiral",
  "smtv Sketch 05 - Shinjuku Wound Array",
];

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe.runIf(existsSync(smtvRoot))("migrated SMTV project files", () => {
  for (const folder of smtvFolders) {
    it(`validates separator targets and journal for ${folder}`, () => {
      const projectDir = resolve(smtvRoot, folder);
      const project = genostProjectSchema.parse(readJson(resolve(projectDir, "genost.json")));
      const journal = commandJournalSchema.parse(readJson(resolve(projectDir, "commands.json")));

      expect(project.blocks.length).toBeGreaterThan(0);
      expect(project.blocks.every((block) => Boolean(block.separatorTarget))).toBe(true);
      expect(journal.commands.some((command) => command.type === "set_block_separator_targets")).toBe(true);
    });
  }
});

describe("repository recovery project files", () => {
  for (const folder of ["Ash_Meridian", "Covenant_Breaker"]) {
    const projectDir = resolve(repositoryRoot, "GENOST_PROJECTS", folder);
    const testProjectFile = existsSync(resolve(projectDir, "genost.json")) ? it : it.skip;

    testProjectFile(`validates ${folder}`, () => {
      const project = genostProjectSchema.parse(readJson(resolve(projectDir, "genost.json")));
      expect(project.blocks.every((block) => block.separatorTarget === "instrumental")).toBe(true);
    });
  }
});

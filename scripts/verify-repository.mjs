import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = p => readFile(join(root, p), "utf8");
const json = async p => JSON.parse(await read(p));
async function files(directory = "") {
  const paths = [];
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    if ([".git", "node_modules", "ops"].includes(entry.name)) continue;
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (path === "docs/status.md") continue;
    if (entry.isDirectory()) paths.push(...await files(path));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}
const paths = await files();
const typo = new RegExp("sl" + "dc", "i");
for (const path of paths) {
  assert(!typo.test(path), `Noncanonical filename: ${path}`);
  assert(!typo.test(await read(path)), `Noncanonical spelling: ${path}`);
}
const pkg = await json("package.json");
const lock = await json("package-lock.json");
assert.equal(pkg.name, "ai-sdlc");
assert.deepEqual(pkg.bin, { "ai-sdlc": "bin/ai-sdlc.mjs" });
assert.equal(lock.name, pkg.name);
assert.equal(lock.packages[""].name, pkg.name);
await read(pkg.bin["ai-sdlc"]);
assert.equal(pkg.scripts["verify:completion"], "node src/cli.mjs verify-completion");
const config = await json("harness.config.json");
assert(config.surfaces.some(surface => surface.filePatterns.includes("**")), "Repository routing must cover new and hidden files too");
const skillLock = await json("jsm/official-skills.lock.json");
const names = new Set(skillLock.skills.map(skill => skill.name));
for (const surface of config.surfaces) {
  for (const stage of ["Assess", "Regress", "Finish"]) assert(surface.skills.some(skill => skill.stages.includes(stage)), `${surface.id} missing ${stage}`);
  for (const skill of surface.skills) assert(names.has(skill.name), `Unpinned method: ${skill.name}`);
  for (const pack of surface.packs) assert.deepEqual(config.packs[pack].commands, ["npm test"]);
}
for (const path of ["AGENTS.md", "templates/AGENTS.sdlc.snippet.md", "docs/management-sop.md", "templates/docs/management-sop.md"]) {
  const body = await read(path);
  assert(body.includes("Carl is not the assistant's assistant."), `${path} missing responsibility rule`);
  assert(/alternatives/i.test(body) && /authentication/i.test(body), `${path} missing escalation boundary`);
}
for (const command of ["assess", "regress", "finish", "verify-completion"]) assert((await read("src/cli.mjs")).includes(`case "${command}"`));
console.log(`Repository contract passed (${paths.length} maintained files; ${skillLock.skill_count} locked methods).`);

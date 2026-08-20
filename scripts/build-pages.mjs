import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(repositoryRoot, "_site");

const publicFiles = [
  "index.html",
  "ar.html",
  "robots.txt",
  "sitemap.xml",
];

const publicDirectories = ["ar", "airborne", "assets", "voltalog"];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const file of publicFiles) {
  await cp(path.join(repositoryRoot, file), path.join(outputDirectory, file));
}

for (const directory of publicDirectories) {
  await cp(path.join(repositoryRoot, directory), path.join(outputDirectory, directory), {
    recursive: true,
    filter: (source) => !source.endsWith(path.join("assets", "nad-maria.jpeg")),
  });
}

console.log(`Prepared public Cloudflare Pages output in ${path.relative(repositoryRoot, outputDirectory)}.`);

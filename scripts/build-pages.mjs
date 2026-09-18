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

const publicDirectories = ["ar", "airborne", "assets", "nexus", "voltalog"];

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

// Publish only the Murex gallery and its photos.
await mkdir(path.join(outputDirectory, "murex"), { recursive: true });
await cp(path.join(repositoryRoot, "murex", "index.html"), path.join(outputDirectory, "murex", "index.html"));
for (const file of ["tracking-config.js", "tracking.js"]) {
  await cp(path.join(repositoryRoot, "murex", file), path.join(outputDirectory, "murex", file));
}
await cp(path.join(repositoryRoot, "murex", "photos"), path.join(outputDirectory, "murex", "photos"), { recursive: true });

console.log(`Prepared public Cloudflare Pages output in ${path.relative(repositoryRoot, outputDirectory)}.`);

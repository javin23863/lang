import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_PATH = path.join(MOBILE, "package-lock.json");
const NODE_MODULES = path.join(MOBILE, "node_modules");
const PRODUCT_NOTICE_PATH = path.resolve(MOBILE, "..", "THIRD-PARTY-NOTICES.md");
const APACHE_LICENSE_PATH = path.resolve(MOBILE, "..", "licenses", "Apache-2.0.txt");
const OUTPUT_PATH = path.join(MOBILE, "www", "third-party-notices.txt");
const LEGAL_FILE = /^(?:licen[cs]e|copying|notice)(?:$|[._-])/i;

async function packageLegalFiles(packageDir) {
  const entries = await readdir(packageDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && LEGAL_FILE.test(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function installedPackage(lockPath, meta) {
  const packageDir = path.join(MOBILE, lockPath);
  let descriptor;
  try {
    descriptor = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT" && meta.optional === true) return null;
    throw error;
  }

  const name = descriptor.name;
  const version = descriptor.version || meta.version;
  if (typeof name !== "string" || !name || typeof version !== "string" || !version) {
    throw new Error(`Production dependency metadata is incomplete for ${lockPath}`);
  }

  const legalFiles = await packageLegalFiles(packageDir);
  if (!legalFiles.length) {
    throw new Error(`Production dependency ${name}@${version} has no packaged LICENSE/NOTICE/COPYING file`);
  }

  return { packageDir, name, version, legalFiles };
}

const lock = JSON.parse(await readFile(LOCK_PATH, "utf8"));
if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== "object") {
  throw new Error("Mobile third-party notice generation requires an npm lockfileVersion 3 package graph");
}

const packageSections = [];
const seen = new Set();
for (const [lockPath, meta] of Object.entries(lock.packages)) {
  if (!lockPath.startsWith("node_modules/") || !meta || meta.dev === true) continue;
  const installed = await installedPackage(lockPath, meta);
  if (!installed) continue;
  const key = `${installed.name}@${installed.version}`;
  if (seen.has(key)) continue;
  seen.add(key);

  const parts = [`===== ${key} =====`];
  for (const legalFile of installed.legalFiles) {
    const text = await readFile(path.join(installed.packageDir, legalFile), "utf8");
    parts.push(`--- ${legalFile} ---\n${text.trim()}`);
  }
  packageSections.push(parts.join("\n\n"));
}

if (!packageSections.length) {
  throw new Error(`No production package licenses were found under ${NODE_MODULES}`);
}
packageSections.sort((a, b) => a.localeCompare(b));

const productNotice = (await readFile(PRODUCT_NOTICE_PATH, "utf8")).trim();
const apacheLicense = (await readFile(APACHE_LICENSE_PATH, "utf8")).trim();
const generated = [
  "Lingua Relay third-party notices",
  "",
  "This installed-app notice is generated from the exact locked production npm dependency graph.",
  "Development-only packages are intentionally excluded. Each bundled package section below copies",
  "the legal files distributed by that installed package; generation fails closed if required legal",
  "material is absent.",
  "",
  "===== Lingua Relay production component notices =====",
  productNotice,
  "",
  "===== Apache License 2.0 text referenced by the production notices =====",
  apacheLicense,
  "",
  "===== Bundled mobile runtime package licenses =====",
  ...packageSections,
  "",
].join("\n");

await writeFile(OUTPUT_PATH, generated, "utf8");

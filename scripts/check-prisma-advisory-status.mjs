const advisory = "GHSA-ggr8-5vv4-36mx";

async function latestPackage(name) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`npm registry returned ${response.status} for ${name}.`);
  return response.json();
}

const [prisma, prismaConfig] = await Promise.all([
  latestPackage("prisma"),
  latestPackage("@prisma/config"),
]);
const deepmergeVersion = prismaConfig.dependencies?.["deepmerge-ts"] ?? null;
const fixed = typeof deepmergeVersion === "string" && /(?:^|[~^])?8(?:\.|$)/.test(deepmergeVersion);

console.log(JSON.stringify({
  advisory,
  status: fixed ? "official-fix-available" : "pending-official-fix",
  prismaVersion: prisma.version,
  prismaConfigVersion: prismaConfig.version,
  deepmergeTsDependency: deepmergeVersion,
  nextAction: fixed
    ? "Review and upgrade the matched Prisma stack; do not use an override."
    : "Keep the P1 confined to build/migrate, preserve runtime containment, and upgrade when a stable Prisma release depends on deepmerge-ts 8 or later.",
}, null, 2));

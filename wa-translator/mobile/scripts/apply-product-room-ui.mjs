import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roomPath = path.join(MOBILE, "www", "room.html");
let html = await readFile(roomPath, "utf8");

const styleTags = [
  '<link rel="stylesheet" href="/room-product-ui.css">',
  '<link rel="stylesheet" href="/room-product-states.css">',
  '<link rel="stylesheet" href="/room-product-prejoin.css">',
];
const scriptTags = [
  '<script src="/room-product-ui.js"></script>',
  '<script src="/room-product-prejoin.js"></script>',
  '<script src="/room-product-defaults.js"></script>',
];

for (const styleTag of styleTags) {
  if (!html.includes(styleTag)) {
    if (!html.includes("</head>")) throw new Error("generated room is missing </head>");
    html = html.replace("</head>", `${styleTag}\n</head>`);
  }
}
for (const scriptTag of scriptTags) {
  if (!html.includes(scriptTag)) {
    if (!html.includes("</body>")) throw new Error("generated room is missing </body>");
    html = html.replace("</body>", `${scriptTag}\n</body>`);
  }
}

await writeFile(roomPath, html);

// dist-electron is compiled to CommonJS while the repo root is "type": "module".
import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync("dist-electron", { recursive: true });
writeFileSync("dist-electron/package.json", JSON.stringify({ type: "commonjs" }, null, 2));

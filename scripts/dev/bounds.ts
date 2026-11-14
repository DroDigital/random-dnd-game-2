import { NodeIO } from "@gltf-transform/core";
import { getBounds } from "@gltf-transform/core";
const io = new NodeIO();
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const b = getBounds(doc.getRoot().listScenes()[0]!);
  console.log(f.split("/").pop(), b.min.map((v) => v.toFixed(2)).join(","), "|", b.max.map((v) => v.toFixed(2)).join(","), "anims", doc.getRoot().listAnimations().map(a=>a.getName()).join(","));
}

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const r = doc.getRoot();
  console.log("==", f.split("/").pop(), "meshes", r.listMeshes().length, "anims", r.listAnimations().length, "skins", r.listSkins().length, "mats", r.listMaterials().map(m=>m.getName()).join(","), "tex", r.listTextures().map(t=>t.getURI()||t.getName()).join(","));
  console.log("   nodes:", r.listNodes().filter(n=>n.getMesh()).map(n=>n.getName()).join(","));
  console.log("   anims:", r.listAnimations().map(a=>a.getName()).join(","));
}

import { NodeIO } from "@gltf-transform/core";
const io = new NodeIO();
const doc = await io.read(process.argv[2]!);
console.log(doc.getRoot().listSkins()[0]!.listJoints().map((j) => j.getName()).join(","));

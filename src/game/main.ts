// Placeholder entry; replaced by the full game boot in step 2.
const c = document.getElementById("screen") as HTMLCanvasElement;
const g = c.getContext("2d")!;
c.width = 480;
c.height = 270;
g.fillStyle = "#14121c";
g.fillRect(0, 0, 480, 270);
g.fillStyle = "#f2b45a";
g.font = "16px monospace";
g.fillText("Roll for Ruin", 180, 135);
(window as unknown as { __rfrReady: boolean }).__rfrReady = true;

import type { RfrApi, UpdateStatus, DisplayInfo } from "../shared/api";
import { defaultSettings, type Settings } from "../shared/settings";

declare global {
  interface Window { rfr?: RfrApi }
}

type Tab = "settings" | "controllers" | "credits" | "updates";
const api = window.rfr;
let settings: Settings = defaultSettings();
let displays: DisplayInfo[] = [];
let tab: Tab = "settings";
let update: UpdateStatus = { state: "idle" };
let version = "dev";
let padRaf = 0;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of kids) e.append(c);
  return e;
};

async function save(): Promise<void> {
  if (api) settings = await api.setSettings(settings);
}

function row(label: string, control: HTMLElement): HTMLElement {
  return el("div", { class: "row" }, el("label", {}, label), control);
}

function select<T extends string | number>(value: T, options: [T, string][], onChange: (v: T) => void, testId: string): HTMLSelectElement {
  const s = el("select", { "data-testid": testId });
  for (const [v, l] of options) {
    const o = el("option", { value: String(v) }, l);
    if (v === value) o.selected = true;
    s.append(o);
  }
  s.addEventListener("change", () => {
    const raw = s.value;
    const typed = (typeof value === "number" ? Number(raw) : raw) as T;
    onChange(typed);
    void save();
  });
  return s;
}

function slider(value: number, min: number, max: number, step: number, onChange: (v: number) => void, testId: string): HTMLElement {
  const wrap = el("span");
  const r = el("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(value), "data-testid": testId });
  const out = el("span", { class: "status" }, ` ${Math.round(value * 100)}%`);
  r.addEventListener("input", () => {
    onChange(Number(r.value));
    out.textContent = ` ${Math.round(Number(r.value) * 100)}%`;
  });
  r.addEventListener("change", () => void save());
  wrap.append(r, out);
  return wrap;
}

function checkbox(value: boolean, onChange: (v: boolean) => void, testId: string): HTMLElement {
  return select<"on" | "off">(value ? "on" : "off", [["on", "On"], ["off", "Off"]], (v) => onChange(v === "on"), testId);
}

function renderSettings(main: HTMLElement): void {
  const s = settings;
  main.append(el("h2", {}, "Settings"));
  main.append(el("h3", {}, "Display"));
  main.append(row("Display mode", select(s.display.mode, [["windowed", "Windowed"], ["borderless", "Borderless window"], ["fullscreen", "Fullscreen"]], (v) => (s.display.mode = v), "set-mode")));
  main.append(row("Monitor", select(s.display.monitor, displays.map((d) => [d.index, `${d.label} (${d.width}x${d.height})${d.primary ? " — primary" : ""}`] as [number, string]), (v) => (s.display.monitor = v), "set-monitor")));
  main.append(row("Render scale", select(s.display.renderScale, [2, 3, 4, 5, 6].map((n) => [n, `${n}x (${480 * n}x${270 * n})`] as [number, string]), (v) => (s.display.renderScale = v), "set-scale")));
  main.append(row("V-Sync (restart)", checkbox(s.display.vsync, (v) => (s.display.vsync = v), "set-vsync")));
  main.append(el("h3", {}, "Audio"));
  main.append(row("Master", slider(s.audio.master, 0, 1, 0.05, (v) => (s.audio.master = v), "set-master")));
  main.append(row("Music", slider(s.audio.music, 0, 1, 0.05, (v) => (s.audio.music = v), "set-music")));
  main.append(row("Sound effects", slider(s.audio.sfx, 0, 1, 0.05, (v) => (s.audio.sfx = v), "set-sfx")));
  main.append(row("Interface", slider(s.audio.ui, 0, 1, 0.05, (v) => (s.audio.ui = v), "set-ui")));
  main.append(el("h3", {}, "Accessibility"));
  const a = s.accessibility;
  main.append(row("Hold actions", select(a.holdMode, [["hold", "Hold"], ["toggle", "Toggle"]], (v) => (a.holdMode = v), "set-hold")));
  main.append(row("Alternative player colors", checkbox(a.altIdentityColors, (v) => (a.altIdentityColors = v), "set-altcolors")));
  main.append(row("Combat speed", slider(a.combatSpeed, 0.7, 1, 0.05, (v) => (a.combatSpeed = v), "set-speed")));
  main.append(row("Large text", checkbox(a.largeText, (v) => (a.largeText = v), "set-large")));
  main.append(row("No screen shake", checkbox(a.noShake, (v) => (a.noShake = v), "set-noshake")));
  main.append(row("Dithering", checkbox(a.dither, (v) => (a.dither = v), "set-dither")));
  main.append(row("Controller glyphs", select(a.glyphs, [["auto", "Automatic"], ["xbox", "Xbox"], ["playstation", "PlayStation"], ["switch", "Switch"]], (v) => (a.glyphs = v), "set-glyphs")));
  main.append(el("h3", {}, "Launcher"));
  main.append(row("Skip launcher", checkbox(s.launcher.skip, (v) => (s.launcher.skip = v), "set-skip")));
  main.append(el("p", { class: "hint" }, "Hold Shift while the game starts to reopen the launcher. Esc in game opens the pause menu with “Return to launcher”."));
  main.append(row("Steam features", checkbox(s.steam.enabled, (v) => (s.steam.enabled = v), "set-steam")));
}

function renderControllers(main: HTMLElement): void {
  main.append(el("h2", {}, "Controller tester"));
  main.append(el("p", { class: "hint" }, "Browsers only reveal a controller after its first button press. Press any button on each pad."));
  const grid = el("div", { class: "pads", "data-testid": "pads" });
  const cards: HTMLElement[] = [];
  for (let i = 0; i < 4; i++) {
    const c = el("div", { class: "pad" }, el("div", {}, `Pad ${i + 1}: waiting…`));
    cards.push(c);
    grid.append(c);
  }
  main.append(grid);
  const loop = (): void => {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < 4; i++) {
      const p = pads[i];
      const c = cards[i]!;
      c.classList.toggle("on", !!p);
      c.replaceChildren();
      if (!p) {
        c.append(el("div", {}, `Pad ${i + 1}: press a button`));
        continue;
      }
      c.append(el("div", {}, `Pad ${i + 1}: ${p.id.slice(0, 48)}`), el("div", { class: "hint" }, `mapping: ${p.mapping || "non-standard"}`));
      const btns = el("div", { class: "btns" });
      p.buttons.forEach((b, bi) => btns.append(el("span", { class: b.pressed ? "down" : "" }, String(bi))));
      const axes = el("div", { class: "axes" });
      for (let ai = 0; ai + 1 < p.axes.length && ai < 4; ai += 2) {
        const st = el("div", { class: "stick" });
        const dot = el("i");
        dot.style.left = `${24 + (p.axes[ai] ?? 0) * 24}px`;
        dot.style.top = `${24 + (p.axes[ai + 1] ?? 0) * 24}px`;
        st.append(dot);
        axes.append(st);
      }
      c.append(btns, axes);
    }
    padRaf = requestAnimationFrame(loop);
  };
  padRaf = requestAnimationFrame(loop);
}

async function renderCredits(main: HTMLElement): Promise<void> {
  main.append(el("h2", {}, "Credits & Licenses"));
  const pre = el("pre", { class: "credits", "data-testid": "credits" }, "Loading…");
  main.append(pre);
  pre.textContent = api ? await api.getCredits() : "Credits are available in the desktop app.";
}

function updateText(u: UpdateStatus): string {
  switch (u.state) {
    case "idle": return "Not checked yet.";
    case "disabled": return `Auto-update off: ${u.reason}.`;
    case "checking": return "Checking for updates…";
    case "available": return `Update ${u.version} found, downloading…`;
    case "none": return `Up to date (${u.version}).`;
    case "downloading": return `Downloading… ${u.percent}%`;
    case "ready": return `Update ${u.version} ready. Restart to install.`;
    case "error": return `Update error: ${u.message}`;
  }
}

function renderUpdates(main: HTMLElement): void {
  main.append(el("h2", {}, "Updates"));
  main.append(el("p", { class: "status", "data-testid": "update-status" }, updateText(update)));
  const check = el("button", {}, "Check now");
  check.addEventListener("click", async () => {
    if (api) update = await api.checkForUpdates();
    render();
  });
  main.append(check);
  if (update.state === "ready") {
    const inst = el("button", {}, "Restart and install");
    inst.addEventListener("click", () => void api?.installUpdate());
    main.append(" ", inst);
  }
}

function render(): void {
  cancelAnimationFrame(padRaf);
  const app = document.getElementById("app")!;
  app.replaceChildren();
  const nav = el("nav");
  nav.append(el("h1", {}, "Roll for Ruin"), el("div", { class: "ver" }, `v${version}`));
  const play = el("button", { class: "play", "data-testid": "play" }, "▶ Play");
  play.addEventListener("click", () => void api?.play());
  nav.append(play);
  const tabs: [Tab, string][] = [["settings", "Settings"], ["controllers", "Controller tester"], ["credits", "Credits & Licenses"], ["updates", "Update status"]];
  for (const [t, label] of tabs) {
    const b = el("button", { class: t === tab ? "active" : "", "data-testid": `tab-${t}` }, label);
    b.addEventListener("click", () => {
      tab = t;
      render();
    });
    nav.append(b);
  }
  const logs = el("button", { "data-testid": "open-logs" }, "Open logs");
  logs.addEventListener("click", () => void api?.openLogs());
  nav.append(logs);
  const quit = el("button", {}, "Quit");
  quit.addEventListener("click", () => void api?.quit());
  nav.append(quit);
  nav.append(el("div", { class: "hint", "data-testid": "nav-update" }, updateText(update)));
  const main = el("main");
  app.append(nav, main);
  if (tab === "settings") renderSettings(main);
  else if (tab === "controllers") renderControllers(main);
  else if (tab === "credits") void renderCredits(main);
  else renderUpdates(main);
}

async function boot(): Promise<void> {
  if (api) {
    settings = await api.getSettings();
    displays = await api.getDisplays();
    version = (await api.appInfo()).version;
    api.onUpdateStatus((s) => {
      update = s;
      const n = document.querySelector('[data-testid="nav-update"]');
      if (n) n.textContent = updateText(s);
    });
  } else {
    displays = [{ index: 0, id: 0, label: "Browser", width: screen.width, height: screen.height, scaleFactor: devicePixelRatio, primary: true }];
  }
  render();
  window.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && document.activeElement === document.body) void api?.play();
  });
}
void boot();

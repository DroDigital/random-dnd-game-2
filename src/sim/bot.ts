import { ITEMS, SCENES } from "../data";
import { nodeById } from "./hexmap";
import { skillBonus } from "./hero";
import type { Command } from "./run";
import type { Ability, SimState } from "./types";

/**
 * Run-level decisions for headless/bot play (balance simulator, all-AI parties): which node to
 * take, what to do at campfires, merchants, skill scenes and loot votes, and when to move on.
 * Deterministic: it only reads state.
 */
export function botCommands(s: SimState, slots: "all" | number[] = "all"): Command[] {
  const run = s.run;
  const mine = s.heroes.filter((h) => slots === "all" || slots.includes(h.slot));
  const out: Command[] = [];
  switch (run.phase) {
    case "actIntro":
      out.push({ c: "continue" });
      break;
    case "map": {
      const cur = nodeById(run.map, run.map.current);
      const opts = cur.next.map((id) => nodeById(run.map, id));
      const hpFrac = s.heroes.reduce((t, h) => t + h.hp / h.maxHp, 0) / Math.max(1, s.heroes.length);
      const score = (k: string): number => {
        switch (k) {
          case "campfire": return hpFrac < 0.6 ? 10 : 2;
          case "merchant": return run.gold > 60 ? 6 : 1;
          case "elite": return hpFrac > 0.8 ? 5 : 0;
          case "encounter": return 4;
          case "mystery": return 3;
          case "skill": return 3;
          default: return 1;
        }
      };
      const best = opts.reduce((a, b) => (score(b.kind) > score(a.kind) || (score(b.kind) === score(a.kind) && b.id < a.id) ? b : a));
      out.push({ c: "chooseNode", node: best.id });
      break;
    }
    case "room":
      if (s.room?.cleared) out.push({ c: "continue" });
      break;
    case "levelup":
      for (const h of mine) {
        const cards = run.pendingCards[h.id];
        if (cards) out.push({ c: "card", hero: h.id, card: cards[0]! });
        const subs = run.pendingSubclass[h.id];
        if (subs) out.push({ c: "subclass", hero: h.id, sub: subs[0]! });
      }
      break;
    case "campfire":
      for (const h of mine) if (!run.campfireDone[h.id]) out.push({ c: "campfire", hero: h.id, choice: h.hp < h.maxHp * 0.85 || h.hitDice === 0 ? "rest" : "upgrade" });
      out.push({ c: "continue" });
      break;
    case "merchant": {
      for (const item of run.merchantStock) {
        const price = ITEMS.prices[ITEMS.items[item]!.rarity]!;
        const buyer = mine.find((h) => h.attuned.length < 3 || !ITEMS.items[item]!.attune);
        if (buyer && run.gold >= price + 15) { out.push({ c: "buy", hero: buyer.id, item }); break; }
      }
      const low = mine.find((h) => h.potions < 2);
      if (low && run.gold >= 30) out.push({ c: "buy", hero: low.id, item: "potion_healing" });
      out.push({ c: "leave" });
      break;
    }
    case "skill": {
      if (run.scene?.result) {
        out.push({ c: "continue" });
        break;
      }
      const sc = SCENES.scenes.find((x) => x.id === run.scene?.id);
      if (!sc) break;
      let best = { opt: 0, hero: s.heroes[0]!.id, bonus: -99 };
      sc.options.forEach((o, i) => {
        for (const h of s.heroes.filter((x) => !x.fallen)) {
          const b = skillBonus(h, o.skill, SCENES.skills[o.skill] as Ability) - o.dc;
          if (b > best.bonus) best = { opt: i, hero: h.id, bonus: b };
        }
      });
      const helper = s.heroes.find((h) => h.id !== best.hero && !h.fallen)?.id ?? null;
      out.push({ c: "skill", option: best.opt, hero: best.hero, helper });
      break;
    }
    case "loot": {
      const lv = run.loot[0];
      if (lv) for (const h of mine) if (lv.votes[h.id] === null) out.push({ c: "vote", hero: h.id, vote: h.attuned.length < 3 ? "need" : "greed" });
      break;
    }
  }
  return out;
}

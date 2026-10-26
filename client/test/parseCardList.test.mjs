import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCardList } from "../src/parseCardList.js";

test("splits a Quizlet/Anki export on tabs", () => {
  const { cards, separator } = parseCardList("cell\tbasic unit of life\natom\tsmallest unit");
  assert.equal(separator, "\t");
  assert.deepEqual(cards, [
    { frontText: "cell", backText: "basic unit of life" },
    { frontText: "atom", backText: "smallest unit" },
  ]);
});

test("a comma inside an answer doesn't split a dash-separated list", () => {
  const { cards } = parseCardList(
    "mitochondria - makes ATP, mostly\nribosome - builds proteins\nnucleus - holds DNA"
  );
  assert.equal(cards[0].backText, "makes ATP, mostly");
  assert.equal(cards.length, 3);
});

test("splits on the first separator only", () => {
  const { cards } = parseCardList("ratio: 1:2\nspeed: 3 m/s");
  assert.deepEqual(cards[0], { frontText: "ratio", backText: "1:2" });
});

test("skips blank lines and reports lines with no back", () => {
  const { cards, skipped } = parseCardList("\n  a - 1 \n\njust a heading\nb - 2\n");
  assert.equal(cards.length, 2);
  assert.deepEqual(skipped, ["just a heading"]);
});

test("empty input gives nothing", () => {
  assert.deepEqual(parseCardList("   \n "), { cards: [], skipped: [], separator: null });
});

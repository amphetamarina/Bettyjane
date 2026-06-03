import { describe, expect, test } from "bun:test";
import type { LiveCoin } from "../src/index";
import { toMemoryView, txExplorerUrl } from "../explorer/view";

const textCoin = (overrides: Partial<LiveCoin> = {}): LiveCoin => ({
  outpoint: { txid: "a".repeat(64), outIdx: 1 },
  sats: 546n,
  memo: { kind: "memory", content: { type: "text", text: "remember the milk" } },
  blockHeight: 100,
  confirmed: true,
  authorVerified: false,
  ...overrides,
});

describe("txExplorerUrl", () => {
  test("points at explorer.e.cash on mainnet", () => {
    expect(txExplorerUrl("mainnet", "ff")).toBe("https://explorer.e.cash/tx/ff");
  });

  test("points at the testnet explorer on testnet", () => {
    expect(txExplorerUrl("testnet", "ff")).toBe("https://texplorer.e.cash/tx/ff");
  });

  test("has no public explorer on regtest", () => {
    expect(txExplorerUrl("regtest", "ff")).toBeNull();
  });
});

describe("toMemoryView", () => {
  test("describes a text memory minted by the agent", () => {
    const view = toMemoryView(textCoin(), "mainnet");
    expect(view).toEqual({
      outpoint: `${"a".repeat(64)}:1`,
      txid: "a".repeat(64),
      sats: "546",
      kind: "memory",
      author: "agent",
      confirmed: true,
      authorVerified: false,
      content: { type: "text", text: "remember the milk", viaPointer: false },
      explorerUrl: `https://explorer.e.cash/tx/${"a".repeat(64)}`,
    });
  });

  test("carries the authorVerified flag from a signed coin (AMP-239)", () => {
    expect(toMemoryView(textCoin({ authorVerified: true }), "mainnet").authorVerified).toBe(true);
    expect(toMemoryView(textCoin({ authorVerified: false }), "mainnet").authorVerified).toBe(false);
  });

  test("renders an encrypted memory as an encrypted view, not its bytes (AMP-242)", () => {
    const coin = textCoin({
      memo: { kind: "memory", content: { type: "encrypted", ciphertext: new Uint8Array([1, 2, 3]) } },
    });
    expect(toMemoryView(coin, "mainnet").content).toEqual({ type: "encrypted" });
  });

  test("attributes a pin to the human author", () => {
    const coin = textCoin({
      memo: { kind: "pin", content: { type: "text", text: "name: Bettyjane" } },
    });
    const view = toMemoryView(coin, "mainnet");
    expect(view.kind).toBe("pin");
    expect(view.author).toBe("human");
  });

  test("renders an unresolved pointer memo as hex", () => {
    const coin = textCoin({
      memo: { kind: "memory", content: { type: "pointer", pointer: new Uint8Array([0xde, 0xad]) } },
    });
    const view = toMemoryView(coin, "mainnet");
    expect(view.content).toEqual({ type: "pointer", pointerHex: "dead" });
  });

  test("renders a resolved pointer memo as text flagged viaPointer", () => {
    const coin = textCoin({
      memo: { kind: "memory", content: { type: "pointer", pointer: new Uint8Array([0xde, 0xad]) } },
    });
    const view = toMemoryView(coin, "mainnet", "the full reassembled note");
    expect(view.content).toEqual({ type: "text", text: "the full reassembled note", viaPointer: true });
  });

  test("carries the unconfirmed flag and a null explorer url on regtest", () => {
    const view = toMemoryView(textCoin({ confirmed: false }), "regtest");
    expect(view.confirmed).toBe(false);
    expect(view.explorerUrl).toBeNull();
  });
});

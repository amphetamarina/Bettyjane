import { describe, expect, test } from "bun:test";
import { InvalidCoinIdError, coinId, parseCoinId } from "../src/index";

const TXID = "a8ef7cba751f22df120e3e8123cdde103303d567cca1fdb71bb6e07750821af7";

describe("coinId", () => {
  test("joins a txid and output index with a colon", () => {
    expect(coinId({ txid: TXID, outIdx: 1 })).toBe(`${TXID}:1`);
  });
});

describe("parseCoinId", () => {
  test("splits a coin id into a txid and output index", () => {
    expect(parseCoinId(`${TXID}:1`)).toEqual({ txid: TXID, outIdx: 1 });
  });

  test("round-trips with coinId", () => {
    const outpoint = { txid: TXID, outIdx: 7 };
    expect(parseCoinId(coinId(outpoint))).toEqual(outpoint);
  });

  test("lowercases an upper-case txid to match on-chain form", () => {
    expect(parseCoinId(`${TXID.toUpperCase()}:0`)).toEqual({ txid: TXID, outIdx: 0 });
  });

  test("rejects a string with no separator", () => {
    expect(() => parseCoinId(TXID)).toThrow(InvalidCoinIdError);
  });

  test("rejects a txid that is not 64 hex chars", () => {
    expect(() => parseCoinId("deadbeef:1")).toThrow(InvalidCoinIdError);
  });

  test("rejects a non-numeric output index", () => {
    expect(() => parseCoinId(`${TXID}:x`)).toThrow(InvalidCoinIdError);
  });

  test("rejects a negative output index", () => {
    expect(() => parseCoinId(`${TXID}:-1`)).toThrow(InvalidCoinIdError);
  });

  test("rejects an empty output index", () => {
    expect(() => parseCoinId(`${TXID}:`)).toThrow(InvalidCoinIdError);
  });
});

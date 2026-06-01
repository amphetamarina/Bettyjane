import { describe, expect, test } from "bun:test";
import { DEFAULT_NETWORK, networkConfig } from "../src/index";

describe("networkConfig", () => {
  test("defaults to testnet so a bootstrap never touches real XEC", () => {
    expect(DEFAULT_NETWORK).toBe("testnet");
    expect(networkConfig().network).toBe("testnet");
    expect(networkConfig().prefix).toBe("ectest");
  });

  test("mainnet uses the ecash prefix", () => {
    expect(networkConfig("mainnet").prefix).toBe("ecash");
  });

  test("overrides the Chronik endpoints, leaving the prefix intact", () => {
    const config = networkConfig("testnet", { chronikUrls: ["https://my-chronik.example"] });
    expect(config.chronikUrls).toEqual(["https://my-chronik.example"]);
    expect(config.prefix).toBe("ectest");
  });
});

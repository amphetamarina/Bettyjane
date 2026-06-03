import { describe, expect, test } from "bun:test";
import { renderTurn } from "../capture/turn";

const line = (obj: unknown) => JSON.stringify(obj);
const user = (content: unknown, extra: object = {}) => line({ type: "user", message: { role: "user", content }, ...extra });
const assistant = (content: unknown) => line({ type: "assistant", message: { role: "assistant", content } });

describe("renderTurn", () => {
  test("renders the last user ask followed by the assistant reply", () => {
    const lines = [user("wire the auth flow"), assistant("done, added a guard")];
    expect(renderTurn(lines, 500)).toBe("User: wire the auth flow\n\nAssistant: done, added a guard");
  });

  test("includes only the latest turn, not earlier exchanges", () => {
    const lines = [
      user("first ask"),
      assistant("first answer"),
      user("second ask"),
      assistant("second answer"),
    ];
    expect(renderTurn(lines, 500)).toBe("User: second ask\n\nAssistant: second answer");
  });

  test("skips isMeta injected user entries when locating the last user message", () => {
    const lines = [
      user("the real ask"),
      assistant("working on it"),
      user([{ type: "text", text: "Base directory for this skill: /x" }], { isMeta: true }),
    ];
    expect(renderTurn(lines, 500)).toBe("User: the real ask\n\nAssistant: working on it");
  });

  test("skips a user entry that carries only a tool result", () => {
    const lines = [
      user("run the tests"),
      assistant("running them"),
      user([{ type: "tool_result", content: "exit 0" }]),
    ];
    expect(renderTurn(lines, 500)).toBe("User: run the tests\n\nAssistant: running them");
  });

  test("collects multiple assistant text entries after the last user message", () => {
    const lines = [
      user("do the thing"),
      assistant([{ type: "text", text: "step one" }]),
      assistant([{ type: "tool_use", name: "Bash" }]),
      assistant([{ type: "text", text: "step two" }]),
    ];
    expect(renderTurn(lines, 500)).toBe("User: do the thing\n\nAssistant: step one\n\nAssistant: step two");
  });

  test("extracts text from array content blocks", () => {
    const lines = [user([{ type: "text", text: "ship it" }]), assistant([{ type: "text", text: "shipped" }])];
    expect(renderTurn(lines, 500)).toBe("User: ship it\n\nAssistant: shipped");
  });

  test("returns an empty string when there is no user text", () => {
    expect(renderTurn([assistant("just talking")], 500)).toBe("");
  });

  test("truncates to the byte budget, keeping the user ask at the head", () => {
    const lines = [user("keep me"), assistant("x".repeat(500))];
    const out = renderTurn(lines, 20);
    expect(out.startsWith("User: keep me")).toBe(true);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(20);
  });
});

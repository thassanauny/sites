import { describe, expect, it } from "vitest";
import { createBoard } from "../src/domain/boards/templates";
import { parseBoard, serializeBoard } from "../src/domain/boards/codec";

describe("portable board files", () => {
  it("exports only the Blueprint board format", () => {
    const exported = JSON.parse(serializeBoard(createBoard()));
    expect(exported.format).toBe("blueprint-board");
    expect(() => parseBoard(JSON.stringify({ ...exported, format: "other-board" })))
      .toThrow("valid Blueprint board JSON file");
  });
  it("round-trips a connected architecture without selection state or reusing its ID", () => {
    const board = createBoard();
    board.nodes[0].selected = true;
    const imported = parseBoard(serializeBoard(board));
    expect(imported.id).not.toBe(board.id);
    expect(imported.nodes).toHaveLength(board.nodes.length);
    expect(imported.edges).toHaveLength(board.edges.length);
    expect(imported.nodes[0].selected).toBeUndefined();
    expect(imported.nodes[0].data).toEqual(board.nodes[0].data);
  });
  it("rejects files with broken connections, duplicate IDs, or unknown components", () => {
    const board = createBoard();
    board.edges[0].target = "missing-node";
    expect(() => parseBoard(serializeBoard(board))).toThrow(
      "invalid connection",
    );
    const duplicate = createBoard();
    duplicate.nodes[1].id = duplicate.nodes[0].id;
    expect(() => parseBoard(serializeBoard(duplicate))).toThrow(
      "invalid component",
    );
    const unknown = JSON.parse(serializeBoard(createBoard()));
    unknown.board.nodes[0].data.kind = "unsafe-kind";
    expect(() => parseBoard(JSON.stringify(unknown))).toThrow(
      "invalid component",
    );
  });
  it("drops arbitrary imported node styles and executable or remote content", () => {
    const payload = JSON.parse(serializeBoard(createBoard()));
    payload.board.nodes[0].style = {
      backgroundImage: "url(https://untrusted.example/track)",
    };
    payload.board.nodes[0].type = "untrusted";
    const imported = parseBoard(JSON.stringify(payload));
    expect(imported.nodes[0].type).toBe("architecture");
    expect(imported.nodes[0].style).toBeUndefined();
  });
  it("starts a truly empty board when the blank template is selected", () => {
    expect(createBoard("blank").nodes).toEqual([]);
    expect(createBoard("blank").edges).toEqual([]);
  });
  it("preserves resized system boundaries in exported boards", () => {
    const board = createBoard("blank");
    board.nodes.push({
      id: "boundary",
      type: "architecture",
      position: { x: 0, y: 0 },
      width: 720,
      height: 420,
      style: { width: 500, height: 340 },
      data: {
        kind: "boundary",
        label: "VPC",
        description: "",
        technology: "",
        tone: "slate",
      },
    });
    const restored = parseBoard(serializeBoard(board));
    expect(restored.nodes[0].style).toEqual({ width: 720, height: 420 });
  });
});

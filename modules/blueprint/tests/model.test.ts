import { describe, expect, it } from "vitest";
import { createBoard } from "../src/domain/boards/templates";
import { componentIconSets, flowComponentKinds } from "../src/domain/boards/types";
import { boardContent, parseBoard, serializeBoard } from "../src/domain/boards/codec";
import { colorDepth } from "../src/domain/boards/appearance";
import { makeNode } from "../src/domain/boards/components";

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
  it.each(componentIconSets.map(({ id }) => id))("preserves the board's %s icon set in portable and shared content", (iconStyle) => {
    const board = createBoard();
    board.iconStyle = iconStyle;
    const imported = parseBoard(serializeBoard(board));
    expect(imported.iconStyle).toBe(iconStyle);
    expect(JSON.parse(boardContent(board)).iconStyle).toBe(iconStyle);
    expect(imported.nodes[0].data).toEqual(board.nodes[0].data);
  });
  it("accepts boards without an icon set and drops unsupported values", () => {
    const board = createBoard();
    const restored = parseBoard(serializeBoard(board));
    expect(restored.iconStyle).toBeUndefined();
    expect(JSON.parse(boardContent(restored))).not.toHaveProperty("iconStyle");
    const payload = JSON.parse(serializeBoard(board));
    payload.board.iconStyle = "unknown-style";
    const imported = parseBoard(JSON.stringify(payload));
    expect(imported.iconStyle).toBeUndefined();
    expect(imported.nodes.map((node) => node.data)).toEqual(board.nodes.map((node) => node.data));
  });
  it.each(["soft", "deep", 0, 37, 100] as const)("preserves the board's %s color intensity in portable and shared content", colorIntensity => {
    const board = { ...createBoard(), colorIntensity };
    const imported = parseBoard(serializeBoard(board));
    expect(imported.colorIntensity).toBe(colorIntensity);
    expect(JSON.parse(boardContent(board)).colorIntensity).toBe(colorIntensity);
    expect(imported.nodes.map(node => node.data)).toEqual(board.nodes.map(node => node.data));
  });
  it.each([[-20, 0], [130, 100], [37.6, 38]])("normalizes imported intensity %s to %s", (value, expected) => {
    const board = { ...createBoard(), colorIntensity: value };
    expect(parseBoard(serializeBoard(board)).colorIntensity).toBe(expected);
  });
  it("maps stored presets and missing values to slider endpoints", () => {
    expect(colorDepth("soft")).toBe(0);
    expect(colorDepth(undefined)).toBe(0);
    expect(colorDepth("deep")).toBe(100);
    expect(colorDepth(Number.NaN)).toBe(0);
  });
  it("keeps boards in Soft colors and drops invalid intensity values", () => {
    const payload = JSON.parse(serializeBoard(createBoard()));
    const restored = parseBoard(JSON.stringify(payload));
    expect(restored.colorIntensity).toBeUndefined();
    expect(JSON.parse(boardContent(restored))).not.toHaveProperty("colorIntensity");
    payload.board.colorIntensity = "unknown";
    const imported = parseBoard(JSON.stringify(payload));
    expect(imported.colorIntensity).toBeUndefined();
    expect(boardContent(imported)).toBe(boardContent(restored));
  });
  it.each(["outline", "isometric", "solid"])("loads boards using the retired %s set with default icons and preserves the diagram", (iconStyle) => {
    const board = createBoard();
    const expected = parseBoard(serializeBoard(board));
    const payload = JSON.parse(serializeBoard(board));
    payload.board.iconStyle = iconStyle;
    const imported = parseBoard(JSON.stringify(payload));
    expect(imported.iconStyle).toBeUndefined();
    expect(imported.title).toBe(board.title);
    expect(imported.description).toBe(board.description);
    expect(imported.nodes).toEqual(expected.nodes);
    expect(imported.edges).toEqual(expected.edges);
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
  it("creates an editable approval workflow with both decision paths and a revision loop", () => {
    const board = parseBoard(serializeBoard(createBoard("workflow")));
    expect(board.title).toBe("Approval workflow");
    expect(board.nodes).toHaveLength(7);
    expect(board.nodes.find(node => node.id === "decision")?.data.kind).toBe("decision");
    expect(board.edges.filter(edge => edge.source === "decision").map(edge => edge.label)).toEqual(["Yes", "Needs changes"]);
    expect(board.edges.some(edge => edge.source === "revise" && edge.target === "submit")).toBe(true);
    const ids = new Set(board.nodes.map(node => node.id));
    expect(board.edges.every(edge => ids.has(edge.source) && ids.has(edge.target))).toBe(true);
  });
  it("starts a truly empty board when the blank template is selected", () => {
    expect(createBoard("blank").nodes).toEqual([]);
    expect(createBoard("blank").edges).toEqual([]);
  });
  it("keeps new note names empty while preserving explicitly named notes and their text", () => {
    const board = createBoard("blank");
    board.nodes.push(makeNode("note", { x: 0, y: 0 }));
    board.nodes.push(makeNode("note", { x: 250, y: 0 }, { label: "Decision", description: "Retry safely." }));
    const imported = parseBoard(serializeBoard(board));
    expect(imported.nodes.map(node => [node.data.label, node.data.description])).toEqual([
      ["", ""], ["Decision", "Retry safely."],
    ]);
    expect(JSON.parse(boardContent(board)).nodes[0].data.label).toBe("");
    expect(createBoard().nodes.find(node => node.data.kind === "note")?.data.label).toBe("A few things to think about…");
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
  it("round-trips workflow types, optional module icons, lane labels, resized frames and their connections", () => {
    const board = createBoard("blank");
    board.nodes = flowComponentKinds.map((kind, index) => makeNode(kind, { x: index * 200, y: 0 }, {
      label: `Custom ${kind}`, description: "Keep the details", technology: "Keep the subtitle",
      ...(kind === "module" ? { showIcon: false } : {}),
      ...(kind === "swimlane" ? { lanes: ["Customer", "Operations", "Payments"] } : {}),
    }));
    board.nodes.at(-1)!.height = 550;
    board.edges = [{ id: "flow", source: board.nodes[1].id, target: board.nodes[2].id, label: "Continue", sourceHandle: "bottom", targetHandle: "top" }];
    const restored = parseBoard(serializeBoard(board));
    expect(restored.nodes.map(node => node.data)).toEqual(board.nodes.map(node => node.data));
    expect(restored.nodes.at(-1)!.style).toEqual({ width: 680, height: 550 });
    expect(restored.edges[0]).toMatchObject(board.edges[0]);
  });
  it("bounds imported swimlanes and drops malformed workflow options", () => {
    const board = createBoard("blank");
    board.nodes = [makeNode("swimlane", { x: 0, y: 0 }), makeNode("module", { x: 0, y: 0 })];
    const payload = JSON.parse(serializeBoard(board));
    payload.board.nodes[0].data.lanes = [null, " ", ...Array.from({ length: 12 }, () => "a".repeat(100))];
    payload.board.nodes[0].style = { width: 1, height: 1, backgroundImage: "url(https://untrusted.example)" };
    payload.board.nodes[1].data.showIcon = "false";
    const restored = parseBoard(JSON.stringify(payload));
    expect(restored.nodes[0].data.lanes).toEqual(Array(8).fill("a".repeat(60)));
    expect(restored.nodes[0].style).toEqual({ width: 360, height: 756 });
    expect(restored.nodes[1].data.showIcon).toBeUndefined();
    payload.board.nodes[0].data.lanes = [];
    expect(parseBoard(JSON.stringify(payload)).nodes[0].data.lanes).toEqual(["Customer", "System"]);
  });
});

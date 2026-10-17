import type { WorkspaceController } from "../../application/useWorkspaceController";
import {
  BookOpen,
  Check,
  Copy,
  Layers3,
  MoveUpRight,
  Trash2,
  X,
} from "lucide-react";
import { ComponentIcon } from "../../ui/ComponentIcon";
import { componentMeta } from "../../domain/boards/components";
import type { Tone } from "../../domain/boards/types";
const tones: Tone[] = ["green", "blue", "purple", "orange", "rose", "slate"];
export function PropertiesPanel({
  controller,
}: {
  controller: Pick<
    WorkspaceController,
    | "board"
    | "update"
    | "readOnly"
    | "setShowInspector"
    | "selectedNodes"
    | "selectedNode"
    | "selectedEdge"
    | "duplicate"
    | "deleteSelection"
    | "updateNode"
  >;
}) {
  const {
    board,
    update,
    readOnly,
    setShowInspector,
    selectedNodes,
    selectedNode,
    selectedEdge,
    duplicate,
    deleteSelection,
    updateNode,
  } = controller;
  return (
    <aside className="inspector">
      <div className="inspector-title">
        <span>
          {selectedNode || selectedEdge ? "Properties" : "Board details"}
        </span>
        <button
          className="icon-button"
          aria-label="Close properties"
          onClick={() => setShowInspector(false)}
        >
          <X size={15} />
        </button>
      </div>
      <div className="inspector-content">
        {selectedNode ? (
          <>
            <div
              className={`selected-component tone-${selectedNode.data.tone}`}
            >
              <span className="node-icon">
                <ComponentIcon kind={selectedNode.data.kind} size={23} />
              </span>
              <div>
                <strong>{componentMeta[selectedNode.data.kind].label}</strong>
                <span>Component properties</span>
              </div>
            </div>
            <label className="field">
              Name
              <input
                key={`${selectedNode.id}-label-${selectedNode.data.label}`}
                readOnly={readOnly}
                defaultValue={selectedNode.data.label}
                onBlur={(event) => {
                  if (event.target.value !== selectedNode.data.label)
                    updateNode({
                      label: event.target.value || "Untitled",
                    });
                }}
                maxLength={120}
              />
            </label>
            {!["note", "text", "boundary"].includes(selectedNode.data.kind) && (
              <label className="field">
                Technology
                <input
                  key={`${selectedNode.id}-tech-${selectedNode.data.technology}`}
                  readOnly={readOnly}
                  defaultValue={selectedNode.data.technology}
                  placeholder="e.g. PostgreSQL"
                  onBlur={(event) => {
                    if (event.target.value !== selectedNode.data.technology)
                      updateNode({ technology: event.target.value });
                  }}
                  maxLength={120}
                />
              </label>
            )}
            <label className="field">
              {selectedNode.data.kind === "note" ? "Note" : "Description"}
              <textarea
                key={`${selectedNode.id}-desc-${selectedNode.data.description}`}
                readOnly={readOnly}
                defaultValue={selectedNode.data.description}
                placeholder="What does this component do?"
                onBlur={(event) => {
                  if (event.target.value !== selectedNode.data.description)
                    updateNode({ description: event.target.value });
                }}
                rows={5}
                maxLength={4000}
              />
            </label>
            <div className="field">
              Color
              <div className="color-options">
                {tones.map((tone) => (
                  <button
                    key={tone}
                    className={`swatch swatch-${tone} ${selectedNode.data.tone === tone ? "selected" : ""}`}
                    disabled={readOnly}
                    aria-label={`${tone} color`}
                    onClick={() => updateNode({ tone })}
                  >
                    {selectedNode.data.tone === tone && <Check size={13} />}
                  </button>
                ))}
              </div>
            </div>
            <div className="inspector-divider" />
            <button
              className="inspector-action"
              disabled={readOnly}
              onClick={duplicate}
            >
              <Copy size={15} />
              Duplicate<kbd>⌘ D</kbd>
            </button>
            <button
              className="inspector-action danger"
              disabled={readOnly}
              onClick={deleteSelection}
            >
              <Trash2 size={15} />
              Delete component<kbd>⌫</kbd>
            </button>
          </>
        ) : selectedEdge ? (
          <>
            <div className="selected-component tone-slate">
              <span className="node-icon">
                <MoveUpRight size={23} />
              </span>
              <div>
                <strong>Connection</strong>
                <span>Show how things flow</span>
              </div>
            </div>
            <label className="field">
              Label
              <input
                key={selectedEdge.id}
                readOnly={readOnly}
                defaultValue={String(selectedEdge.label || "")}
                placeholder="e.g. HTTPS / read / write"
                maxLength={120}
                onBlur={(event) =>
                  update((current) => ({
                    ...current,
                    edges: current.edges.map((edge) =>
                      edge.id === selectedEdge.id
                        ? { ...edge, label: event.target.value }
                        : edge,
                    ),
                  }))
                }
              />
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                disabled={readOnly}
                checked={Boolean(selectedEdge.animated)}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    edges: current.edges.map((edge) =>
                      edge.id === selectedEdge.id
                        ? {
                            ...edge,
                            animated: event.target.checked,
                            style: {
                              ...edge.style,
                              strokeDasharray: event.target.checked
                                ? "5 5"
                                : undefined,
                            },
                          }
                        : edge,
                    ),
                  }))
                }
              />
              Animate data flow
            </label>
            <button
              className="inspector-action danger"
              disabled={readOnly}
              onClick={deleteSelection}
            >
              <Trash2 size={15} />
              Delete connection
            </button>
          </>
        ) : selectedNodes.length > 1 ? (
          <>
            <div className="selected-component tone-green">
              <span className="node-icon">
                <Layers3 size={23} />
              </span>
              <div>
                <strong>{selectedNodes.length} components</strong>
                <span>Selected together</span>
              </div>
            </div>
            <button
              className="inspector-action"
              disabled={readOnly}
              onClick={duplicate}
            >
              <Copy size={15} />
              Duplicate selection
            </button>
            <button
              className="inspector-action danger"
              disabled={readOnly}
              onClick={deleteSelection}
            >
              <Trash2 size={15} />
              Delete selection
            </button>
          </>
        ) : (
          <>
            <div className="board-details-icon">
              <BookOpen size={22} strokeWidth={1.5} />
            </div>
            <p className="eyebrow">THE BIG PICTURE</p>
            <h2>
              A system worth
              <br />
              thinking through.
            </h2>
            <p className="details-intro">
              A place to map the pieces, connect your ideas, and see how it all
              fits.
            </p>
            <label className="field">
              Board name
              <input
                key={`${board.id}-title-${board.title}`}
                readOnly={readOnly}
                defaultValue={board.title}
                onBlur={(event) => {
                  if (event.target.value !== board.title)
                    update(
                      (current) => ({
                        ...current,
                        title: event.target.value.trim() || "Untitled board",
                      }),
                      false,
                    );
                }}
                maxLength={120}
              />
            </label>
            <label className="field">
              Description
              <textarea
                key={`${board.id}-description-${board.description}`}
                readOnly={readOnly}
                defaultValue={board.description}
                placeholder="What are we designing?"
                onBlur={(event) => {
                  if (event.target.value !== board.description)
                    update(
                      (current) => ({
                        ...current,
                        description: event.target.value,
                      }),
                      false,
                    );
                }}
                rows={4}
                maxLength={4000}
              />
            </label>
            <div className="board-stats">
              <div>
                <strong>
                  {board.nodes
                    .filter(
                      (node) =>
                        !["note", "text", "boundary"].includes(node.data.kind),
                    )
                    .length.toString()
                    .padStart(2, "0")}
                </strong>
                <span>components</span>
              </div>
              <div>
                <strong>
                  {board.edges.length.toString().padStart(2, "0")}
                </strong>
                <span>connections</span>
              </div>
            </div>
            <div className="inspector-divider" />
            <div className="design-checklist">
              <span className="eyebrow">A GOOD DESIGN ASKS</span>
              <p>
                <span>01</span>Where does the data flow?
              </p>
              <p>
                <span>02</span>What happens when it fails?
              </p>
              <p>
                <span>03</span>How does it grow?
              </p>
            </div>
          </>
        )}
      </div>
      <div className="inspector-footer">
        <span className="private-dot" />
        <span>Just you and your next big idea.</span>
      </div>
    </aside>
  );
}

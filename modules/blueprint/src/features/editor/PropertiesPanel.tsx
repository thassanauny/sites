import { useCallback, useEffect, useId, useRef } from "react";
import type { WorkspaceController } from "../../application/useWorkspaceController";
import {
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
  const popup = useRef<HTMLElement>(null);
  const titleId = useId();
  const close = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && popup.current?.contains(active)) active.blur();
    setShowInspector(false);
  }, [setShowInspector]);
  useEffect(() => {
    const element = popup.current!;
    const opener = document.activeElement;
    const position = () => {
      const header = document.querySelector('.topbar')!.getBoundingClientRect();
      element.style.setProperty('--properties-top', `${header.bottom + 12}px`);
    };
    position();
    element.showPopover();
    (element.querySelector<HTMLElement>('input, textarea') ?? element.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !element.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', position);
    const resize = new ResizeObserver(position);
    resize.observe(document.querySelector('.topbar')!);
    return () => {
      const restoreFocus = element.contains(document.activeElement) || document.activeElement === document.body;
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', position);
      resize.disconnect();
      element.hidePopover();
      if (restoreFocus && opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [close]);
  return (
    <aside ref={popup} popover="manual" className="properties-popup" role="dialog" aria-labelledby={titleId}>
      <div className="properties-popup-heading">
        <h2 id={titleId}>Properties</h2>
        <button className="icon-button" aria-label="Close properties" onClick={close}><X size={17} /></button>
      </div>
      <div className="properties-popup-content">
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
        ) : null}
      </div>
    </aside>
  );
}

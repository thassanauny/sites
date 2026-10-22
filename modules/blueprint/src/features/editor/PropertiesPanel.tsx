import { useCallback, useEffect, useRef } from "react";
import { PropertyField } from "./PropertyField";
import { useOnViewportChange } from "@xyflow/react";
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
import { componentMeta, isFlowKind, isFrameKind, swimlaneLabels } from "../../domain/boards/components";
import { componentKinds, type ComponentKind, type Tone } from "../../domain/boards/types";
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
  const reposition = useRef(() => {});
  useOnViewportChange({ onChange: () => reposition.current() });
  const selectionKey = selectedNodes.map(node => node.id).join(",") + ":" + (selectedEdge?.id ?? "");
  const close = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && popup.current?.contains(active)) active.blur();
    setShowInspector(false);
  }, [setShowInspector]);
  useEffect(() => {
    const element = popup.current!;
    const opener = document.activeElement;
    const header = document.querySelector('.topbar')!;
    const canvas = document.querySelector('#main-content')!;
    const position = () => {
      const gap = 12;
      const topLimit = header.getBoundingClientRect().bottom + gap;
      const maxHeight = Math.max(120, window.innerHeight - topLimit - gap);
      element.style.setProperty('--properties-max-height', `${maxHeight}px`);
      const { width, height } = element.getBoundingClientRect();
      const rightLimit = window.innerWidth - width - gap;
      const leftLimit = Math.min(canvas.getBoundingClientRect().left + gap, rightLimit);
      const anchors = [...document.querySelectorAll('.react-flow__node.selected, .react-flow__edge.selected')].map(anchor => anchor.getBoundingClientRect());
      const anchor = anchors.length ? {
        left: Math.min(...anchors.map(bounds => bounds.left)),
        right: Math.max(...anchors.map(bounds => bounds.right)),
        top: Math.min(...anchors.map(bounds => bounds.top)),
        bottom: Math.max(...anchors.map(bounds => bounds.bottom)),
      } : canvas.getBoundingClientRect();
      let left = anchor.right + gap;
      let top = anchor.top;
      if (left > rightLimit) left = anchor.left - width - gap;
      if (left < leftLimit) {
        left = anchor.left;
        top = anchor.bottom + gap;
        if (top + height > window.innerHeight - gap) top = anchor.top - height - gap;
      }
      left = Math.max(leftLimit, Math.min(left, rightLimit));
      top = Math.max(topLimit, Math.min(top, window.innerHeight - height - gap));
      element.style.setProperty('--properties-left', `${left}px`);
      element.style.setProperty('--properties-top', `${top}px`);
    };
    let frame = 0;
    const schedulePosition = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(position);
    };
    reposition.current = schedulePosition;
    element.showPopover();
    position();
    schedulePosition();
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
    window.addEventListener('resize', schedulePosition);
    const resize = new ResizeObserver(schedulePosition);
    resize.observe(header);
    resize.observe(canvas);
    resize.observe(element);
    return () => {
      const restoreFocus = element.contains(document.activeElement) || document.activeElement === document.body;
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', schedulePosition);
      cancelAnimationFrame(frame);
      reposition.current = () => {};
      resize.disconnect();
      element.hidePopover();
      if (restoreFocus && opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [close, selectionKey]);
  return (
    <aside ref={popup} popover="manual" className="properties-popup" role="dialog" aria-label="Properties">
      <div className="properties-popup-heading">
        <div className={`selected-component tone-${selectedNode?.data.tone ?? (selectedEdge ? "slate" : "green")}`}>
          <span className="node-icon">
            {selectedNode ? <ComponentIcon kind={selectedNode.data.kind} size={20} />
              : selectedEdge ? <MoveUpRight size={20} aria-hidden="true" />
              : <Layers3 size={20} aria-hidden="true" />}
          </span>
          <div>
            <h2>Properties</h2>
            {selectedNode && !["note", "text"].includes(selectedNode.data.kind) && !isFrameKind(selectedNode.data.kind)
              ? <select className="component-type-select" aria-label="Component type" value={selectedNode.data.kind} disabled={readOnly} onChange={event => updateNode({ kind: event.target.value as ComponentKind })}>
                  {["System components", "Workflows"].map(category => <optgroup label={category} key={category}>
                    {componentKinds.filter(kind => componentMeta[kind].category === category && !isFrameKind(kind)).map(kind => <option key={kind} value={kind}>{componentMeta[kind].label}</option>)}
                  </optgroup>)}
                </select>
              : <span>{selectedNode ? componentMeta[selectedNode.data.kind].label
                  : selectedEdge ? "Connection" : `${selectedNodes.length} components`}</span>}
          </div>
        </div>
        <button className="icon-button" aria-label="Close properties" onClick={close}><X size={17} /></button>
      </div>
      <div className="properties-popup-content">
        {selectedNode ? (
          <>
            {selectedNode.data.kind === "text" ? <label className="field">
              Text
              <PropertyField multiline
                key={`${selectedNode.id}-label`}
                readOnly={readOnly}
                value={selectedNode.data.label}
                placeholder="Write text…"
                rows={3}
                maxLength={120}
                onChange={(label, remember) => updateNode({ label }, remember)}
              />
            </label> : <label className="field">
              {selectedNode.data.kind === "note" ? "Name (optional)" : "Name"}
              <PropertyField
                key={`${selectedNode.id}-label`}
                readOnly={readOnly}
                value={selectedNode.data.label}
                placeholder={selectedNode.data.kind === "note" ? "Add a name" : undefined}
                onChange={(label, remember) => updateNode({ label }, remember)}
                maxLength={120}
              />
            </label>}
            {!["note", "text"].includes(selectedNode.data.kind) && !isFrameKind(selectedNode.data.kind) && (
              <label className="field">
                {isFlowKind(selectedNode.data.kind) ? "Subtitle (optional)" : "Technology"}
                <PropertyField
                  key={`${selectedNode.id}-tech`}
                  readOnly={readOnly}
                  value={selectedNode.data.technology}
                  placeholder={isFlowKind(selectedNode.data.kind) ? "Add a subtitle" : "e.g. PostgreSQL"}
                  onChange={(technology, remember) => updateNode({ technology }, remember)}
                  maxLength={120}
                />
              </label>
            )}
            {selectedNode.data.kind === "module" && <label className="checkbox-field">
              <input type="checkbox" disabled={readOnly} checked={selectedNode.data.showIcon !== false} onChange={event => updateNode({ showIcon: event.target.checked })} />
              Show icon
            </label>}
            {selectedNode.data.kind === "swimlane" && <label className="field">
              Lanes (one per line, up to 8)
              <PropertyField multiline key={`${selectedNode.id}-lanes`} readOnly={readOnly}
                value={swimlaneLabels(selectedNode.data.lanes).join("\n")} rows={4} maxLength={487}
                normalize={text => swimlaneLabels(text.split("\n")).join("\n")}
                onChange={(text, remember) => updateNode({ lanes: swimlaneLabels(text.split("\n")) }, remember)} />
            </label>}
            {selectedNode.data.kind !== "note" && <label className="field">
              Description
              <PropertyField multiline
                key={`${selectedNode.id}-desc`}
                readOnly={readOnly}
                value={selectedNode.data.description}
                placeholder="What does this component do?"
                onChange={(description, remember) => updateNode({ description }, remember)}
                rows={3}
                maxLength={4000}
              />
            </label>}
            <div className="field property-color-field">
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
            <div className="properties-popup-actions">
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
              aria-label="Delete component"
              disabled={readOnly}
              onClick={deleteSelection}
            >
              <Trash2 size={15} />
              Delete<kbd>⌫</kbd>
            </button>
            </div>
          </>
        ) : selectedEdge ? (
          <>
            <label className="field">
              Label
              <PropertyField
                key={selectedEdge.id}
                readOnly={readOnly}
                value={String(selectedEdge.label || "")}
                placeholder="e.g. HTTPS / read / write"
                maxLength={120}
                onChange={(label, remember) =>
                  update((current) => ({
                    ...current,
                    edges: current.edges.map((edge) =>
                      edge.id === selectedEdge.id
                        ? { ...edge, label }
                        : edge,
                    ),
                  }), remember)
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
            <div className="properties-popup-actions">
            <button
              className="inspector-action"
              aria-label="Duplicate selection"
              disabled={readOnly}
              onClick={duplicate}
            >
              <Copy size={15} />
              Duplicate
            </button>
            <button
              className="inspector-action danger"
              aria-label="Delete selection"
              disabled={readOnly}
              onClick={deleteSelection}
            >
              <Trash2 size={15} />
              Delete
            </button>
            </div>
          </>
        ) : null}
      </div>
    </aside>
  );
}

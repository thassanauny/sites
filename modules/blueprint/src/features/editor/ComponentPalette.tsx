import type { WorkspaceController } from "../../application/useWorkspaceController";
import { TemplateCards } from "../boards/TemplateCards";
import {
  Grid2X2,
  LayoutTemplate,
  Plus,
  Search,
} from "lucide-react";
import { ComponentIcon } from "../../ui/ComponentIcon";
import { componentKinds } from "../../domain/boards/types";
import { componentMeta } from "../../domain/boards/components";
export function ComponentPalette({
  controller,
}: {
  controller: Pick<
    WorkspaceController,
    | "readOnly"
    | "board"
    | "sidebarTab"
    | "setSidebarTab"
    | "search"
    | "setSearch"
    | "addComponent"
    | "newBoard"
  >;
}) {
  const {
    readOnly,
    board,
    sidebarTab,
    setSidebarTab,
    search,
    setSearch,
    addComponent,
    newBoard,
  } = controller;
  return (
    <aside className="sidebar">
      <div className="sidebar-tabs">
        <button
          className={sidebarTab === "components" ? "active" : ""}
          onClick={() => setSidebarTab("components")}
        >
          <Grid2X2 size={15} />
          Components
        </button>
        <button
          className={sidebarTab === "templates" ? "active" : ""}
          onClick={() => setSidebarTab("templates")}
        >
          <LayoutTemplate size={15} />
          Templates
        </button>
      </div>
      <div className="sidebar-scroll">
        {sidebarTab === "components" ? (
          <>
            <div className="palette-intro">
              <h2>Your building blocks</h2>
              <p>Big systems start with small pieces.</p>
            </div>
            <label className="search-field">
              <Search size={15} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find a component…"
                aria-label="Find a component"
              />
              <kbd>/</kbd>
            </label>
            {["System components", "Workflows", "Annotations"].map(
              (category) => {
                const kinds = componentKinds.filter(
                  (kind) =>
                    componentMeta[kind].category === category &&
                    `${componentMeta[kind].label} ${componentMeta[kind].technology}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                );
                return (
                  kinds.length > 0 && (
                    <section className="palette-section" key={category}>
                      <h3>{category}</h3>
                      <div className="component-grid">
                        {kinds.map((kind) => (
                          <button
                            className={`component-tile tone-${componentMeta[kind].tone}`}
                            key={kind}
                            draggable={!readOnly}
                            disabled={readOnly}
                            onDragStart={(event) => {
                              event.dataTransfer.setData(
                                "application/blueprint",
                                kind,
                              );
                              event.dataTransfer.effectAllowed = "move";
                            }}
                            onClick={() => addComponent(kind)}
                            title={`Add ${componentMeta[kind].label}`}
                          >
                            <span className="component-tile-icon">
                              <ComponentIcon kind={kind} size={21} />
                            </span>
                            <span>{componentMeta[kind].label}</span>
                            <Plus className="tile-plus" size={12} />
                          </button>
                        ))}
                      </div>
                    </section>
                  )
                );
              },
            )}
            {search &&
              !componentKinds.some((kind) =>
                `${componentMeta[kind].label} ${componentMeta[kind].technology}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              ) && (
                <p className="empty-search">
                  No components found. Try “service” or “cache”.
                </p>
              )}
          </>
        ) : (
          <div className="sidebar-template-list">
            <div className="palette-intro">
              <h2>A head start, on us.</h2>
              <p>Pick a pattern. Make it your own.</p>
            </div>
            <div className="sidebar-template-cards"><TemplateCards onChoose={newBoard} /></div>
          </div>
        )}
      </div>
      <div className="sidebar-footer">
        <span className="footer-board-change">Last board change: <time dateTime={board.updatedAt}>{new Date(board.updatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', hour12: true })}</time></span>
      </div>
    </aside>
  );
}

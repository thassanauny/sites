import { ArrowUpRight, Plus } from "lucide-react";
import { templates } from "../../domain/boards/templates";
import type { TemplateId } from "../../domain/boards/templates";
export function TemplateCards({
  onChoose,
  disabled = false,
}: {
  onChoose: (id: TemplateId) => void;
  disabled?: boolean;
}) {
  return (
    <>
      {templates.map((template) => (
        <button
          className="template-card"
          disabled={disabled}
          key={template.id}
          onClick={() => onChoose(template.id)}
        >
          <div
            className={`template-preview preview-${template.id}`}
            aria-hidden="true"
          >
            {template.id === "blank" ? (
              <Plus size={26} />
            ) : (
              <>
                <span />
                <i />
                <span />
                <i />
                <span />
                {template.id === "event-driven" && <b />}
              </>
            )}
          </div>
          <div className="template-text">
            <small>{template.tag}</small>
            <strong>{template.title}</strong>
            <p>{template.description}</p>
            <span>
              {template.count
                ? `${template.count} components`
                : "Infinite possibilities"}
              <ArrowUpRight size={15} />
            </span>
          </div>
        </button>
      ))}
    </>
  );
}

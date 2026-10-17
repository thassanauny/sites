import { ArrowUpRight, Plus } from "lucide-react";
import { templates } from "../../domain/boards/templates";
import type { TemplateId } from "../../domain/boards/templates";
export function TemplateCards({
  onChoose,
}: {
  onChoose: (id: TemplateId) => void;
}) {
  return (
    <>
      {templates.map((template, index) => (
        <button
          className="template-card"
          key={template.id}
          onClick={() => onChoose(template.id)}
        >
          <div
            className={`template-preview preview-${index}`}
            aria-hidden="true"
          >
            {index === 2 ? (
              <Plus size={26} />
            ) : (
              <>
                <span />
                <i />
                <span />
                <i />
                <span />
                {index === 1 && <b />}
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

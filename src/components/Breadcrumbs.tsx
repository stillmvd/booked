import type { Crumb } from "../lib/types";

interface BreadcrumbsProps {
  crumbs: Crumb[];
  onNavigate: (id: number | null) => void;
}

export function Breadcrumbs({ crumbs, onNavigate }: BreadcrumbsProps) {
  return (
    <div className="breadcrumbs">
      <button type="button" className="breadcrumb" onClick={() => onNavigate(null)}>
        Trove
      </button>
      {crumbs.map((crumb) => (
        <span className="breadcrumb-group" key={crumb.id}>
          <span className="breadcrumb-sep">/</span>
          <button type="button" className="breadcrumb" onClick={() => onNavigate(crumb.id)}>
            {crumb.name}
          </button>
        </span>
      ))}
    </div>
  );
}

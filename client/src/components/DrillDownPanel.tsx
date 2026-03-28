import { useState } from "react";
import { ChevronRight, X, Layers, Globe, Package, Tag, Barcode, ShoppingCart } from "lucide-react";

interface DrillDownPanelProps {
  anchorX: number;
  anchorY: number;
  barName: string;
  parentDimension: "category" | "subcategory" | "material" | "region";
  onDrillLevelSelect: (drillLevel: string) => void;
  onClose: () => void;
}

type Step = "menu" | "dimension" | "hierarchy";

const PRODUCT_HIERARCHY = [
  { level: "subcategory", label: "Product Subcategory", icon: Layers },
  { level: "material", label: "Material Code", icon: Barcode },
  { level: "sku", label: "SKU", icon: ShoppingCart },
];

const REGION_HIERARCHY = [
  { level: "category", label: "Product Category", icon: Package },
  { level: "subcategory", label: "Product Subcategory", icon: Layers },
  { level: "material", label: "Material Code", icon: Barcode },
];

const DIMENSIONS = [
  { key: "product", label: "Product Dimension", icon: Package },
  { key: "region", label: "Region Dimension", icon: Globe },
];

export function DrillDownPanel({
  anchorX,
  anchorY,
  barName,
  parentDimension,
  onDrillLevelSelect,
  onClose,
}: DrillDownPanelProps) {
  const [step, setStep] = useState<Step>("menu");
  const [selectedDimension, setSelectedDimension] = useState<string | null>(null);

  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const panelW = 240;
  const panelH = 280;
  const left = Math.min(anchorX, viewportW - panelW - 16);
  const top = Math.min(anchorY, viewportH - panelH - 16);

  const hierarchyOptions =
    selectedDimension === "region"
      ? REGION_HIERARCHY
      : PRODUCT_HIERARCHY;

  return (
    <div
      className="fixed z-50"
      style={{ left, top }}
      data-testid="drilldown-panel"
      onClick={(e) => e.stopPropagation()}
    >
      {step === "menu" && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden w-56">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{barName}</span>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600" data-testid="drilldown-close">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
            onClick={() => setStep("dimension")}
            data-testid="drilldown-open-menu"
          >
            <Layers className="w-4 h-4 text-blue-500" />
            <span className="font-medium">Dimension Drill-Down</span>
            <ChevronRight className="w-4 h-4 ml-auto text-gray-400" />
          </button>
        </div>
      )}

      {step === "dimension" && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden w-56">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
            <button
              onClick={() => setStep("menu")}
              className="text-gray-400 hover:text-gray-600 text-xs"
              data-testid="drilldown-back-to-menu"
            >
              ←
            </button>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Select Dimension</span>
            <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600" data-testid="drilldown-close-dimension">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {DIMENSIONS.map((dim) => (
            <button
              key={dim.key}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors border-b border-gray-50 last:border-0"
              onClick={() => {
                setSelectedDimension(dim.key);
                setStep("hierarchy");
              }}
              data-testid={`drilldown-dimension-${dim.key}`}
            >
              <dim.icon className="w-4 h-4 text-blue-500 flex-shrink-0" />
              <span className="font-medium text-left">{dim.label}</span>
              <ChevronRight className="w-4 h-4 ml-auto text-gray-400 flex-shrink-0" />
            </button>
          ))}
        </div>
      )}

      {step === "hierarchy" && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden w-60">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
            <button
              onClick={() => setStep("dimension")}
              className="text-gray-400 hover:text-gray-600 text-xs"
              data-testid="drilldown-back-to-dimension"
            >
              ←
            </button>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Select Level</span>
            <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600" data-testid="drilldown-close-hierarchy">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="px-3 py-2 bg-blue-50 border-b border-blue-100">
            <span className="text-xs text-blue-600">Drilling into: <strong>{barName}</strong></span>
          </div>
          {hierarchyOptions.map((h, idx) => (
            <button
              key={h.level}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors border-b border-gray-50 last:border-0"
              onClick={() => {
                onDrillLevelSelect(h.level);
                onClose();
              }}
              data-testid={`drilldown-level-${h.level}`}
            >
              <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                {idx + 1}
              </div>
              <h.icon className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <span className="font-medium text-left">{h.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

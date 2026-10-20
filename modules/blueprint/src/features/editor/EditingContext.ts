import { createContext } from "react";

export const EditingContext = createContext<{
  editable: boolean;
  updateAnnotation?: (id: string, text: string, remember: boolean) => void;
}>({ editable: false });

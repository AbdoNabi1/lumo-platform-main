import type { ReactNode } from "react";
// Ruling 29: the font picker shows each family in itself. @font-face downloads lazily.
import "@fontsource/cairo/400.css";
import "@fontsource/cairo/700.css";
import "@fontsource/tajawal/400.css";
import "@fontsource/tajawal/700.css";
import "@fontsource/almarai/400.css";
import "@fontsource/almarai/700.css";
import "@fontsource/readex-pro/400.css";
import "@fontsource/readex-pro/700.css";
import "@fontsource/amiri/400.css";
import "@fontsource/amiri/700.css";

export default function CustomizeLayout({ children }: { readonly children: ReactNode }) {
  return children;
}

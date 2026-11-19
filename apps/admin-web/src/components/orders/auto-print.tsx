"use client";

import { useEffect, useRef } from "react";

/** Opens the browser's print dialog once the slips are on screen (once, even under StrictMode). */
export function AutoPrint() {
  const printed = useRef(false);
  useEffect(() => {
    if (printed.current) return;
    printed.current = true;
    window.print();
  }, []);
  return null;
}

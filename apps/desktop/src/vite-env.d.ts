/// <reference types="vite/client" />

import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "wave-roll": DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & {
          files?: string;
          readonly?: boolean;
        },
        HTMLElement
      >;
    }
  }
}

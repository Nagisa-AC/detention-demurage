declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export function getDocument(input: { data: Uint8Array }): {
    promise: Promise<{
      numPages: number;
      getPage(number: number): Promise<{
        getTextContent(): Promise<{ items: readonly { str?: string }[] }>;
        cleanup(): void;
      }>;
      cleanup(): Promise<void>;
    }>;
    destroy(): Promise<void>;
  };
}

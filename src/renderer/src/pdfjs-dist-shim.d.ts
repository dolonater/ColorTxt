declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export const GlobalWorkerOptions: { workerSrc: string };
  export const ImageKind: {
    GRAYSCALE_1BPP: number;
    RGB_24BPP: number;
    RGBA_32BPP: number;
  };
  export const OPS: Record<string, number>;
  export const AnnotationType: { LINK: number };
  export function getDocument(src: Record<string, unknown>): {
    promise: Promise<{
      numPages: number;
      getDestination: (name: string) => Promise<unknown>;
      getPageIndex: (ref: object) => Promise<number>;
      getPage: (i: number) => Promise<{
        getTextContent: () => Promise<{ items: unknown[] }>;
        getOperatorList: () => Promise<{
          fnArray: number[];
          argsArray: unknown[][];
        }>;
        getAnnotations: () => Promise<unknown[]>;
        objs: {
          has: (id: string) => boolean;
          get: (id: string, cb?: (data: unknown) => void) => unknown;
        };
      }>;
      destroy: () => Promise<void>;
    }>;
  };
}

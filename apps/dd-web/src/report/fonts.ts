import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Font } from "@react-pdf/renderer";

const dir = fontDir();

function fontDir(): string {
  const candidates = [
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fonts"),
    path.join(process.cwd(), "fonts"),
    path.join(process.cwd(), "apps/dd-web/fonts"),
  ];
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, "Inter-Regular.ttf"))) ?? candidates[0] ?? "fonts";
}

export const fontFile = {
  regular: path.join(dir, "Inter-Regular.ttf"),
  medium: path.join(dir, "Inter-Medium.ttf"),
  semibold: path.join(dir, "Inter-SemiBold.ttf"),
  bold: path.join(dir, "Inter-Bold.ttf"),
  mono: path.join(dir, "DejaVuSansMono.ttf"),
  monoBold: path.join(dir, "DejaVuSansMono-Bold.ttf"),
};

let ready = false;

/** Inter and DejaVu Sans Mono. Registered once so two renders subset the same faces. */
export function registerReportFonts(): void {
  if (ready) return;
  ready = true;
  Font.register({
    family: "Inter",
    fonts: [
      { src: fontFile.regular, fontWeight: 400 },
      { src: fontFile.medium, fontWeight: 500 },
      { src: fontFile.semibold, fontWeight: 600 },
      { src: fontFile.bold, fontWeight: 700 },
    ],
  });
  Font.register({
    family: "Mono",
    fonts: [
      { src: fontFile.mono, fontWeight: 400 },
      { src: fontFile.monoBold, fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
}

export function readFont(file: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(file));
}

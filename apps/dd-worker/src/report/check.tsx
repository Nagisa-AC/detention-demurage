import { Document, Page, Text, renderToBuffer } from "@react-pdf/renderer";
import { registerReportFonts } from "./fonts.js";

/** One page, using the bundled Inter file. The deploy runs this before it ships the tarball. */
export async function renderProbePage(): Promise<Uint8Array> {
  registerReportFonts();
  const bytes = await renderToBuffer(
    <Document>
      <Page size="LETTER">
        <Text style={{ fontFamily: "Inter", fontSize: 12 }}>Tidemark Recovery</Text>
      </Page>
    </Document>,
  );
  return new Uint8Array(bytes);
}

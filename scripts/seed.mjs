import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const URL = process.env.CONVEX_URL || "https://wry-donkey-777.convex.cloud";
const EMAIL = "tester@loopledger.test";
const PASSWORD = "testpassword123";

function buildPdf(pageCount) {
  const objects = [];
  const encoder = new TextEncoder();

  const addObject = (body) => {
    objects.push(body);
    return objects.length; // 1-based object number
  };

  // Reserve catalog (1) and pages (2) numbers up front.
  const catalogNum = 1;
  const pagesNum = 2;
  objects.push(null); // catalog placeholder
  objects.push(null); // pages placeholder
  const fontNum = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const pageNums = [];
  for (let i = 0; i < pageCount; i += 1) {
    const text = `Page ${i + 1} of ${pageCount}  -  WhichStitch test pattern`;
    const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET\n` +
      `BT /F1 14 Tf 72 680 Td (Row 1: knit across) Tj ET\n` +
      `BT /F1 14 Tf 72 660 Td (Row 2: purl across) Tj ET`;
    const contentNum = addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageNum = addObject(
      `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${fontNum} 0 R >> >> /Contents ${contentNum} 0 R >>`
    );
    pageNums.push(pageNum);
  }

  objects[catalogNum - 1] = `<< /Type /Catalog /Pages ${pagesNum} 0 R >>`;
  objects[pagesNum - 1] =
    `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageCount} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNum} 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF`;

  return encoder.encode(pdf);
}

async function main() {
  const client = new ConvexHttpClient(URL);
  const result = await client.action(api.auth.signIn, {
    provider: "password",
    params: { email: EMAIL, password: PASSWORD, flow: "signIn" }
  });
  const token = result?.tokens?.token;
  if (!token) {
    console.error("Sign-in did not return a token:", JSON.stringify(result));
    process.exit(1);
  }
  client.setAuth(token);

  const pageCount = 3;
  const bytes = buildPdf(pageCount);
  const blob = new Blob([bytes], { type: "application/pdf" });

  const uploadUrl = await client.mutation(api.projects.generateUploadUrl, {});
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: blob
  });
  if (!uploadResponse.ok) {
    console.error("Upload failed", uploadResponse.status, await uploadResponse.text());
    process.exit(1);
  }
  const { storageId } = await uploadResponse.json();

  const fingerprint = `seed-${Date.now()}`;
  const created = await client.mutation(api.projects.createFromPdf, {
    storageId,
    name: "Cabled Pullover Sampler",
    sourceFileName: "cabled-pullover.pdf",
    fingerprint,
    pageCount,
    pdfMimeType: "application/pdf"
  });

  await client.mutation(api.projects.saveWorkspace, {
    projectId: created.projectId,
    workspace: {
      zoom: 1.1,
      annotations: [],
      counters: [
        { id: "c1", pageIndex: 0, x: 0.18, y: 0.32, type: "row", label: "Body rows", value: 12 },
        { id: "c2", pageIndex: 0, x: 0.6, y: 0.55, type: "stitch", label: "Repeat", value: 4 }
      ],
      connections: [],
      referenceCapture: null,
      strokeColor: "#c62828",
      calculator: {
        patternRowsPerInch: "",
        patternStitchesPerInch: "",
        observedRowsPerInch: "",
        observedStitchesPerInch: "",
        direction: "patternToObserved",
        rowInput: "",
        stitchInput: ""
      },
      anchors: [{ id: "a1", name: "Sleeve shaping", pageIndex: 1, yRatio: 0.3 }]
    }
  });

  console.log("Seeded project:", created.projectId);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

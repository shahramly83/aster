// Synthetic resume PDF generator for apply-flow fixtures.
//
// The public apply page (/apply/<id>) accepts a CV upload, which parse-application
// then runs through Claude. To exercise that end to end we need a real PDF whose
// text layer is extractable (not a scanned image). pdfkit writes a proper text
// layer, so the parser sees real words.
//
// Usage:
//   node tests/fixtures/make-resume.mjs                      -> writes tests/fixtures/resume.pdf
//   node tests/fixtures/make-resume.mjs /path/out.pdf        -> writes to a path
//   import { makeResume } from "./make-resume.mjs"; await makeResume(path, {...})
import PDFDocument from "pdfkit";
import { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DEFAULT = {
  name: "Jordan Avery Chen",
  title: "Senior Frontend Engineer",
  email: "jordan.chen@example.com",
  phone: "+1 (415) 555-0142",
  location: "San Francisco, CA",
  summary:
    "Frontend engineer with 8 years building React and TypeScript applications at " +
    "scale. Led design-system and performance work across three product teams.",
  skills: ["React", "TypeScript", "Node.js", "GraphQL", "Playwright", "Accessibility", "Vite"],
  experience: [
    {
      role: "Senior Frontend Engineer",
      company: "Northwind Labs",
      dates: "2021 - Present",
      bullets: [
        "Owned the migration of a 200k-line app to React 19 and Vite, cutting build time by 60%.",
        "Built the shared component library used by 40 engineers across 6 squads.",
        "Drove Core Web Vitals from failing to passing on all key routes.",
      ],
    },
    {
      role: "Frontend Engineer",
      company: "Bluepeak Software",
      dates: "2018 - 2021",
      bullets: [
        "Shipped the customer analytics dashboard used by 12k monthly active users.",
        "Introduced end-to-end tests, reducing regression escapes by 45%.",
      ],
    },
  ],
  education: [{ degree: "B.S. Computer Science", school: "University of Washington", dates: "2014 - 2018" }],
};

export function makeResume(outPath, overrides = {}) {
  const data = { ...DEFAULT, ...overrides };
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 54 });
    const stream = createWriteStream(outPath);
    stream.on("finish", () => resolve(outPath));
    stream.on("error", reject);
    doc.pipe(stream);

    doc.fontSize(22).font("Helvetica-Bold").text(data.name);
    doc.moveDown(0.2);
    doc.fontSize(12).font("Helvetica").fillColor("#444").text(data.title);
    doc.fontSize(10).text(`${data.email}  |  ${data.phone}  |  ${data.location}`);
    doc.fillColor("#000").moveDown(0.8);

    const heading = (t) => {
      doc.moveDown(0.6).fontSize(13).font("Helvetica-Bold").text(t.toUpperCase());
      doc.moveTo(doc.x, doc.y).lineTo(541, doc.y).strokeColor("#ccc").stroke();
      doc.moveDown(0.3).font("Helvetica").fontSize(10.5).fillColor("#000");
    };

    heading("Summary");
    doc.text(data.summary);

    heading("Skills");
    doc.text(data.skills.join(" · "));

    heading("Experience");
    for (const job of data.experience) {
      doc.font("Helvetica-Bold").fontSize(11).text(`${job.role}, ${job.company}`, { continued: true });
      doc.font("Helvetica").fillColor("#666").text(`   ${job.dates}`);
      doc.fillColor("#000").fontSize(10.5);
      for (const b of job.bullets) doc.text(`• ${b}`, { indent: 10 });
      doc.moveDown(0.4);
    }

    heading("Education");
    for (const e of data.education) doc.text(`${e.degree}, ${e.school} (${e.dates})`);

    doc.end();
  });
}

// Run directly: node tests/fixtures/make-resume.mjs [outPath]
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = process.argv[2] || join(here, "resume.pdf");
  makeResume(out).then((p) => console.log(`wrote ${p}`)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
